import { createHash } from 'node:crypto';
import { formatJoinCode, JOIN_CODE_ALPHABET } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { LAST_SEEN_THROTTLE_MS, PAIRING_CODE_MS } from '../src/devices.ts';
import { GUESS_WINDOW_MS, JOIN_MAX_WRONG_GLOBAL, JOIN_MAX_WRONG_PER_IP } from '../src/rate-limit.ts';
import { cookieFrom, HOST_PASSWORD, pairDevice, REMOTE, signInHost } from './helpers.ts';

const START = Date.parse('2027-07-10T12:00:00Z');

let app: FastifyInstance;
let db: Database;
let clock = START;
let host = '';
/** Every response body the test saw, to check what leaves the server. */
let bodies: string[] = [];

async function start(options: AppOptions = {}): Promise<void> {
  clock = START;
  bodies = [];
  db = openDatabase(':memory:');
  app = await buildApp({ db, now: () => clock, hostPassword: HOST_PASSWORD, ...options });
  host = await signInHost(app);
}

beforeEach(() => start());
afterEach(() => app.close());

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  options: { cookie?: string; payload?: unknown; remoteAddress?: string; headers?: Record<string, string> } = {},
) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: options.remoteAddress ?? REMOTE,
    ...(options.payload !== undefined && { payload: options.payload as object }),
    headers: { ...(options.cookie && { cookie: options.cookie }), ...options.headers },
  });
  bodies.push(res.body);
  return res;
}

const makeCode = async (role: 'display' | 'signup' = 'display') => {
  const res = await call('POST', '/api/pairing/codes', { cookie: host, payload: { role } });
  expect(res.statusCode).toBe(201);
  return res.json() as { code: string; role: string; expiresAt: string };
};
const join = (code: string, remoteAddress = REMOTE, headers?: Record<string, string>) =>
  call('POST', '/api/devices/join', { payload: { code }, remoteAddress, ...(headers && { headers }) });

describe('POST /api/pairing/codes', () => {
  it('makes a 6-character code from the join alphabet, with the role and an expiry 10 minutes away', async () => {
    const body = await makeCode('signup');
    expect(Object.keys(body).sort()).toEqual(['code', 'expiresAt', 'role']);
    expect(body.role).toBe('signup');
    expect(body.code).toHaveLength(6);
    for (const char of body.code) expect(JOIN_CODE_ALPHABET).toContain(char);
    expect(body.expiresAt).toBe(new Date(START + PAIRING_CODE_MS).toISOString());
    expect(PAIRING_CODE_MS).toBe(10 * 60 * 1000);
  });

  it('answers 201 and makes a different code each time', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) codes.add((await makeCode()).code);
    expect(codes.size).toBe(20);
  });

  it('needs a host session', async () => {
    const res = await call('POST', '/api/pairing/codes', { payload: { role: 'display' } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'not-signed-in' });
  });

  it('is not open to a paired device', async () => {
    const { cookie } = await pairDevice(app, host, 'signup');
    expect((await call('POST', '/api/pairing/codes', { cookie, payload: { role: 'display' } })).statusCode).toBe(401);
  });

  it.each([[{}], [{ role: 'host' }], [{ role: 'display', extra: 1 }], [{ role: 1 }]])('answers bad-request for the body %j', async (payload) => {
    const res = await call('POST', '/api/pairing/codes', { cookie: host, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });

  it('removes spent and expired codes when a new one is made', async () => {
    const used = await makeCode();
    await join(used.code);
    await makeCode();
    clock = START + PAIRING_CODE_MS;
    await makeCode();
    expect(db.prepare('SELECT COUNT(*) AS n FROM pairing_codes').get()).toEqual({ n: 1 });
  });
});

describe('POST /api/devices/join', () => {
  it('pairs a device: 201, the device with the role it was made for, and the device cookie', async () => {
    const { code } = await makeCode('display');
    const res = await join(code);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      device: { id: expect.any(Number), role: 'display', label: 'Display 1', lastSeen: new Date(START).toISOString() },
    });
    expect(Object.keys(res.json().device).sort()).toEqual(['id', 'label', 'lastSeen', 'role']);
    expect(cookieFrom(res).startsWith('cg_device=')).toBe(true);
  });

  it('works once: the same code is refused the second time', async () => {
    const { code } = await makeCode();
    expect((await join(code)).statusCode).toBe(201);
    const again = await join(code);
    expect(again.statusCode).toBe(404);
    expect(again.json()).toEqual({ error: 'wrong-code' });
    expect(again.headers['set-cookie']).toBeUndefined();
    expect((await call('GET', '/api/devices', { cookie: host })).json().devices).toHaveLength(1);
  });

  it('lets only one of several joins with the same code at the same moment in', async () => {
    const { code } = await makeCode();
    const results = await Promise.all(Array.from({ length: 5 }, (_unused, i) => join(code, `198.51.100.${i + 1}`)));
    expect(results.map((res) => res.statusCode).sort()).toEqual([201, 404, 404, 404, 404]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM devices').get()).toEqual({ n: 1 });
  });

  it('expires a code after 10 minutes, to the millisecond', async () => {
    const early = await makeCode();
    const late = await makeCode();
    clock = START + PAIRING_CODE_MS - 1;
    expect((await join(early.code)).statusCode).toBe(201);
    clock = START + PAIRING_CODE_MS;
    const res = await join(late.code);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'wrong-code' });
  });

  it('reads the code as a person types it: lower case, with a hyphen or spaces', async () => {
    const codes = [await makeCode(), await makeCode(), await makeCode()];
    const typed = [formatJoinCode(codes[0]!.code).toLowerCase(), ` ${codes[1]!.code.slice(0, 3)} ${codes[1]!.code.slice(3)} `, codes[2]!.code];
    for (const text of typed) expect((await join(text, `198.51.100.${typed.indexOf(text) + 1}`)).statusCode, text).toBe(201);
  });

  it('refuses an unknown code and a code that can not be read, both as wrong-code', async () => {
    for (const code of ['ZZZZZZ', 'K7M-4QX', '', 'ABC', '0O1IL2', 'AAAAAAAA']) {
      const res = await join(code);
      expect(res.statusCode, code).toBe(404);
      expect(res.json(), code).toEqual({ error: 'wrong-code' });
    }
  });

  it.each([[{}], [{ code: 123456 }], [{ code: 'x'.repeat(65) }], [{ code: 'K7M4QX', extra: 1 }]])('answers bad-request for the body %j', async (payload) => {
    const res = await call('POST', '/api/devices/join', { payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });

  it('needs no sign-in, so a new TV can pair', async () => {
    const { code } = await makeCode();
    expect((await join(code, '198.51.100.55')).statusCode).toBe(201);
  });

  it('numbers labels by role, and reuses the lowest free number after an unpair', async () => {
    const d1 = (await pairDevice(app, host, 'display')).device;
    const s1 = (await pairDevice(app, host, 'signup')).device;
    const d2 = (await pairDevice(app, host, 'display')).device;
    const s2 = (await pairDevice(app, host, 'signup')).device;
    expect([d1.label, s1.label, d2.label, s2.label]).toEqual(['Display 1', 'Sign-up 1', 'Display 2', 'Sign-up 2']);
    await call('DELETE', `/api/devices/${d1.id}`, { cookie: host });
    expect((await pairDevice(app, host, 'display')).device.label).toBe('Display 1');
    expect((await pairDevice(app, host, 'display')).device.label).toBe('Display 3');
  });

  it('stores only a SHA-256 hash of the device token', async () => {
    const { cookie } = await pairDevice(app, host, 'display');
    const token = cookie.split('=')[1] as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = db.prepare('SELECT token_hash FROM devices').get() as { token_hash: string };
    expect(row.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect((await call('GET', '/api/devices/me', { cookie: `cg_device=${row.token_hash}` })).statusCode).toBe(401);
  });

  it('replaces the old device when a paired browser pairs again', async () => {
    const first = await pairDevice(app, host, 'display');
    const { code } = await makeCode('signup');
    const res = await call('POST', '/api/devices/join', { cookie: first.cookie, payload: { code } });
    expect(res.statusCode).toBe(201);
    const devices = (await call('GET', '/api/devices', { cookie: host })).json().devices;
    expect(devices).toHaveLength(1);
    expect(devices[0].role).toBe('signup');
    expect((await call('GET', '/api/devices/me', { cookie: first.cookie })).statusCode).toBe(401);
  });
});

describe('wrong pairing codes are rate limited per client IP', () => {
  it.each(['offline', 'online'] as const)('in %s mode: blocks after the limit, even for a live code', async (mode) => {
    await app.close();
    await start({ mode });
    const { code } = await makeCode();
    for (let i = 0; i < JOIN_MAX_WRONG_PER_IP; i++) expect((await join('ZZZZZZ')).statusCode).toBe(404);
    for (const text of ['ZZZZZZ', code]) {
      const res = await join(text);
      expect(res.statusCode).toBe(429);
      expect(res.json()).toEqual({ error: 'too-many-tries' });
    }
    // The live code was not spent by the refused tries.
    expect((await join(code, '198.51.100.99')).statusCode).toBe(201);
  });

  it('lets only the limit of guesses sent at the same moment get an answer other than 429', async () => {
    const results = await Promise.all(Array.from({ length: 40 }, () => join('ZZZZZZ')));
    const codes = results.map((res) => res.statusCode);
    expect(codes.filter((code) => code === 404).length).toBe(JOIN_MAX_WRONG_PER_IP);
    expect(codes.filter((code) => code === 429).length).toBe(40 - JOIN_MAX_WRONG_PER_IP);
  });

  it('starts over when the window ends', async () => {
    for (let i = 0; i < JOIN_MAX_WRONG_PER_IP; i++) await join('ZZZZZZ');
    expect((await join('ZZZZZZ')).statusCode).toBe(429);
    // The window and a code's life are both 10 minutes, so make the code after it ends.
    clock = START + GUESS_WINDOW_MS;
    expect((await join((await makeCode()).code)).statusCode).toBe(201);
  });

  it('does not count a right code, and does not forget the mistakes before it', async () => {
    for (let i = 0; i < JOIN_MAX_WRONG_PER_IP - 1; i++) await join('ZZZZZZ');
    expect((await join((await makeCode()).code)).statusCode).toBe(201);
    // 9 mistakes still stand: one more is allowed, then the address is locked.
    expect((await join('ZZZZZZ')).statusCode).toBe(404);
    expect((await join('ZZZZZZ')).statusCode).toBe(429);
  });

  it('counts unreadable codes as guesses', async () => {
    for (let i = 0; i < JOIN_MAX_WRONG_PER_IP; i++) await join('!!!');
    expect((await join('ZZZZZZ')).statusCode).toBe(429);
  });

  it('counts an IPv6 address by its /64, so rotating inside one range gets no fresh tries', async () => {
    for (let i = 0; i < JOIN_MAX_WRONG_PER_IP; i++) await join('ZZZZZZ', `2001:db8:1:2::${i + 1}`);
    expect((await join('ZZZZZZ', '2001:db8:1:2:aaaa:bbbb:cccc:dddd')).statusCode).toBe(429);
    expect((await join('ZZZZZZ', '2001:db8:1:3::1')).statusCode).toBe(404);
  });

  it('keeps other addresses unaffected', async () => {
    for (let i = 0; i < JOIN_MAX_WRONG_PER_IP + 3; i++) await join('ZZZZZZ');
    expect((await join((await makeCode()).code, '198.51.100.99')).statusCode).toBe(201);
  });

  it('keys on the last X-Forwarded-For entry from the trusted proxy, and ignores it from anyone else', async () => {
    await app.close();
    await start({ mode: 'online', trustedProxy: '10.0.0.1' });
    for (let i = 0; i < JOIN_MAX_WRONG_PER_IP; i++) {
      await join('ZZZZZZ', '10.0.0.1', { 'x-forwarded-for': `203.0.113.${i}, 192.0.2.50` });
    }
    expect((await join('ZZZZZZ', '10.0.0.1', { 'x-forwarded-for': '203.0.113.250, 192.0.2.50' })).statusCode).toBe(429);
    expect((await join('ZZZZZZ', '10.0.0.1', { 'x-forwarded-for': '203.0.113.250, 192.0.2.51' })).statusCode).toBe(404);
    for (let i = 0; i < JOIN_MAX_WRONG_PER_IP; i++) await join('ZZZZZZ', REMOTE, { 'x-forwarded-for': `203.0.113.${i}` });
    expect((await join('ZZZZZZ', REMOTE, { 'x-forwarded-for': '203.0.113.200' })).statusCode).toBe(429);
  });
});

describe('wrong pairing codes are rate limited across all callers', () => {
  // A different address for each guess, so only the global limit can be what stops them.
  const address = (n: number) => `203.0.${Math.floor(n / 250)}.${(n % 250) + 1}`;
  const guess = (n: number) => join('ZZZZZZ', address(n));

  it.each(['offline', 'online'] as const)('in %s mode: answers 429 to every join once the cap is used up', async (mode) => {
    await app.close();
    await start({ mode });
    const { code } = await makeCode();
    for (let n = 0; n < JOIN_MAX_WRONG_GLOBAL; n++) expect((await guess(n)).statusCode).toBe(404);
    for (const text of ['ZZZZZZ', code]) {
      const res = await join(text, '198.51.100.99');
      expect(res.statusCode).toBe(429);
      expect(res.json()).toEqual({ error: 'too-many-tries' });
    }
    // The refused join did not spend the live code. It pairs once the window has ended.
    clock = START + GUESS_WINDOW_MS;
    expect((await join((await makeCode()).code, '198.51.100.99')).statusCode).toBe(201);
  });

  it('counts only guesses the per-IP limit let through', async () => {
    // 50 tries from one address: 10 are answered and counted, the other 40 are refused uncounted.
    for (let i = 0; i < 50; i++) await join('ZZZZZZ', '198.51.100.1');
    for (let n = 0; n < JOIN_MAX_WRONG_GLOBAL - JOIN_MAX_WRONG_PER_IP - 1; n++) await guess(n);
    expect((await guess(1000)).statusCode).toBe(404);
    expect((await guess(1001)).statusCode).toBe(429);
  });

  it('does not count joins that work', async () => {
    for (let n = 0; n < JOIN_MAX_WRONG_GLOBAL + 20; n++) {
      expect((await join((await makeCode()).code, address(n))).statusCode).toBe(201);
    }
    expect((await guess(5000)).statusCode).toBe(404);
  });
});

describe('the device cookie', () => {
  const attributes = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie']).split('; ').slice(1);

  it('is HttpOnly and SameSite=Strict, lasts 400 days, and is not Secure over plain HTTP', async () => {
    const res = await join((await makeCode()).code);
    expect(attributes(res)).toEqual(['Path=/', `Max-Age=${400 * 24 * 60 * 60}`, 'HttpOnly', 'SameSite=Strict']);
  });

  it('is Secure when the trusted proxy says the request was HTTPS', async () => {
    await app.close();
    await start({ mode: 'online', trustedProxy: '10.0.0.1' });
    const { code } = await makeCode();
    const res = await join(code, '10.0.0.1', { 'x-forwarded-proto': 'https', 'x-forwarded-for': REMOTE });
    expect(attributes(res)).toContain('Secure');
  });

  it('does not expire on the server: it still works long after the pairing code and any host session', async () => {
    const { cookie } = await pairDevice(app, host, 'display');
    clock = START + 90 * 24 * 60 * 60 * 1000;
    expect((await call('GET', '/api/devices/me', { cookie })).statusCode).toBe(200);
  });
});

describe('GET /api/devices/me', () => {
  it('answers the device that asks', async () => {
    const { cookie, device } = await pairDevice(app, host, 'signup');
    const res = await call('GET', '/api/devices/me', { cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ device });
  });

  it('answers 401 not-paired without a device cookie, with only a host session, or with a bad one', async () => {
    for (const cookie of [undefined, host, 'cg_device=garbage', 'cg_device=']) {
      const res = await call('GET', '/api/devices/me', cookie === undefined ? {} : { cookie });
      expect(res.statusCode, String(cookie)).toBe(401);
      expect(res.json()).toEqual({ error: 'not-paired' });
    }
  });
});

describe('GET /api/devices and DELETE /api/devices/:id', () => {
  it('lists devices for the host, with id, role, label, and lastSeen only', async () => {
    const a = await pairDevice(app, host, 'display');
    const b = await pairDevice(app, host, 'signup');
    const res = await call('GET', '/api/devices', { cookie: host });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ devices: [a.device, b.device] });
  });

  it('is empty at first', async () => {
    expect((await call('GET', '/api/devices', { cookie: host })).json()).toEqual({ devices: [] });
  });

  it('is closed to devices and to people who are not signed in', async () => {
    const { cookie } = await pairDevice(app, host, 'signup');
    for (const who of [undefined, cookie]) {
      const res = await call('GET', '/api/devices', who === undefined ? {} : { cookie: who });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'not-signed-in' });
    }
  });

  it('unpairs: 204, and the token stops working at once', async () => {
    const { cookie, device } = await pairDevice(app, host, 'display');
    expect((await call('GET', '/api/devices/me', { cookie })).statusCode).toBe(200);
    const res = await call('DELETE', `/api/devices/${device.id}`, { cookie: host });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect((await call('GET', '/api/devices/me', { cookie })).statusCode).toBe(401);
    expect((await call('GET', '/api/event', { cookie })).statusCode).toBe(401);
    expect((await call('GET', '/api/devices', { cookie: host })).json()).toEqual({ devices: [] });
  });

  it('answers 404 for an unknown device and bad-request for a bad id', async () => {
    const missing = await call('DELETE', '/api/devices/999', { cookie: host });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not-found' });
    for (const id of ['abc', '0', '-1', '01']) {
      const res = await call('DELETE', `/api/devices/${id}`, { cookie: host });
      expect(res.statusCode, id).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
  });

  it('needs a host session to unpair', async () => {
    const { cookie, device } = await pairDevice(app, host, 'display');
    for (const who of [undefined, cookie]) {
      expect((await call('DELETE', `/api/devices/${device.id}`, who === undefined ? {} : { cookie: who })).statusCode).toBe(401);
    }
    expect((await call('GET', '/api/devices/me', { cookie })).statusCode).toBe(200);
  });
});

describe('lastSeen', () => {
  it('is refreshed by API use, at most once per throttle period', async () => {
    const { cookie, device } = await pairDevice(app, host, 'display');
    const lastSeen = async () => (await call('GET', '/api/devices', { cookie: host })).json().devices[0].lastSeen as string;
    expect(await lastSeen()).toBe(new Date(START).toISOString());

    clock = START + LAST_SEEN_THROTTLE_MS - 1;
    await call('GET', '/api/event', { cookie });
    expect(await lastSeen()).toBe(new Date(START).toISOString());

    clock = START + LAST_SEEN_THROTTLE_MS;
    await call('GET', '/api/event', { cookie });
    expect(await lastSeen()).toBe(new Date(clock).toISOString());
    expect(device.lastSeen).toBe(new Date(START).toISOString());
  });
});

describe('the event', () => {
  it('is null before it is named, for the host and for any paired device', async () => {
    const display = await pairDevice(app, host, 'display');
    const signup = await pairDevice(app, host, 'signup');
    for (const cookie of [host, display.cookie, signup.cookie]) {
      const res = await call('GET', '/api/event', { cookie });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ event: null });
    }
  });

  it('is named by the host, and every screen then reads it', async () => {
    const display = await pairDevice(app, host, 'display');
    const put = await call('PUT', '/api/event', { cookie: host, payload: { name: 'Summer Smash' } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ event: { name: 'Summer Smash' } });
    for (const cookie of [host, display.cookie]) {
      expect((await call('GET', '/api/event', { cookie })).json()).toEqual({ event: { name: 'Summer Smash' } });
    }
  });

  it('renames the same event instead of adding another', async () => {
    await call('PUT', '/api/event', { cookie: host, payload: { name: 'One' } });
    await call('PUT', '/api/event', { cookie: host, payload: { name: 'Two' } });
    expect((await call('GET', '/api/event', { cookie: host })).json()).toEqual({ event: { name: 'Two' } });
    expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 1 });
  });

  it('tidies the name: trims it and joins runs of spaces', async () => {
    const res = await call('PUT', '/api/event', { cookie: host, payload: { name: '  Friday \t Night   Brawl ' } });
    expect(res.json()).toEqual({ event: { name: 'Friday Night Brawl' } });
  });

  it.each([[''], ['   '], ['x'.repeat(61)], ['bad\u0000name'], ['zero​width'], ['x'.repeat(241)]])('refuses the name %j as bad-request', async (name) => {
    await call('PUT', '/api/event', { cookie: host, payload: { name: 'Kept' } });
    const res = await call('PUT', '/api/event', { cookie: host, payload: { name } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect((await call('GET', '/api/event', { cookie: host })).json()).toEqual({ event: { name: 'Kept' } });
  });

  it('accepts a name of exactly 60 characters', async () => {
    const name = 'x'.repeat(60);
    expect((await call('PUT', '/api/event', { cookie: host, payload: { name } })).json()).toEqual({ event: { name } });
  });

  it.each([[{}], [{ name: 5 }], [{ name: 'A', extra: true }]])('answers bad-request for the body %j', async (payload) => {
    expect((await call('PUT', '/api/event', { cookie: host, payload })).statusCode).toBe(400);
  });

  it('can only be changed by the host', async () => {
    const display = await pairDevice(app, host, 'display');
    for (const who of [undefined, display.cookie]) {
      const res = await call('PUT', '/api/event', { ...(who && { cookie: who }), payload: { name: 'Nope' } });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'not-signed-in' });
    }
  });

  it('can only be read by the host or a paired device', async () => {
    const res = await call('GET', '/api/event');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'not-signed-in' });
  });
});

describe('what leaves the server (CLAUDE.md, rule 1)', () => {
  it('never includes a token, a hash, or a column outside the contract in any answer', async () => {
    const display = await pairDevice(app, host, 'display');
    const signup = await pairDevice(app, host, 'signup');
    await join('ZZZZZZ');
    await call('GET', '/api/devices', { cookie: host });
    await call('GET', '/api/devices/me', { cookie: display.cookie });
    await call('PUT', '/api/event', { cookie: host, payload: { name: 'Summer' } });
    await call('GET', '/api/event', { cookie: signup.cookie });
    await call('DELETE', `/api/devices/${display.device.id}`, { cookie: host });

    const tokens = [host, display.cookie, signup.cookie].map((cookie) => cookie.split('=')[1] as string);
    const hashes = (db.prepare('SELECT token_hash FROM devices').all() as { token_hash: string }[]).map((row) => row.token_hash);
    expect(bodies.length).toBeGreaterThan(5);
    const all = bodies.join('\n');
    for (const leak of ['token_hash', 'tokenHash', 'created_at', 'createdAt', 'used_at', 'expires_at', 'password', 'scrypt$', ...tokens, ...hashes]) {
      expect(all, leak).not.toContain(leak);
    }
  });
});
