import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { HOST_SESSION_MS } from '../src/host-store.ts';
import { GUESS_WINDOW_MS, SIGN_IN_MAX_WRONG_PER_IP } from '../src/rate-limit.ts';
import { verifyPin } from '../src/pin-hash.ts';
import { cookieFrom, HOST_PASSWORD, REMOTE, signInHost, withCookie } from './helpers.ts';

const START = Date.parse('2027-07-10T12:00:00Z');

let app: FastifyInstance | undefined;
let db: Database;
let clock = START;
/** Every response body the test saw, to check what leaves the server. */
let bodies: string[] = [];

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(options: AppOptions = {}): Promise<FastifyInstance> {
  clock = START;
  bodies = [];
  db = openDatabase(':memory:');
  app = await buildApp({ db, now: () => clock, ...options });
  return app;
}

async function call(
  server: FastifyInstance,
  method: 'GET' | 'POST',
  url: string,
  options: { payload?: unknown; remoteAddress?: string; headers?: Record<string, string> } = {},
) {
  const res = await server.inject({
    method,
    url,
    remoteAddress: options.remoteAddress ?? REMOTE,
    ...(options.payload !== undefined && { payload: options.payload as object }),
    ...(options.headers && { headers: options.headers }),
  });
  bodies.push(res.body);
  return res;
}

const LOCAL = '127.0.0.1';
const signIn = (server: FastifyInstance, password: string, remoteAddress = REMOTE, headers?: Record<string, string>) =>
  call(server, 'POST', '/api/host/sign-in', { payload: { password }, remoteAddress, ...(headers && { headers }) });

describe('GET /api/host/session', () => {
  it('offline, from another device with no password: signed out, nothing to set up', async () => {
    const server = await start();
    const res = await call(server, 'GET', '/api/host/session');
    expect(res.json()).toEqual({ signedIn: false, passwordSet: false, canSetUp: false });
  });

  it('offline, from the laptop with no password: signed in, and setup is open', async () => {
    const server = await start();
    const res = await call(server, 'GET', '/api/host/session', { remoteAddress: LOCAL });
    expect(res.json()).toEqual({ signedIn: true, passwordSet: false, canSetUp: true });
  });

  it('offline, from the laptop once a password is set: still signed in, setup closed', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    const res = await call(server, 'GET', '/api/host/session', { remoteAddress: LOCAL });
    expect(res.json()).toEqual({ signedIn: true, passwordSet: true, canSetUp: false });
  });

  it('answers only the three documented fields', async () => {
    const server = await start();
    const res = await call(server, 'GET', '/api/host/session');
    expect(Object.keys(res.json()).sort()).toEqual(['canSetUp', 'passwordSet', 'signedIn']);
  });
});

describe('online mode: nothing is trusted because it comes from localhost', () => {
  it('still needs the host password for a request from localhost', async () => {
    const server = await start({ mode: 'online', hostPassword: HOST_PASSWORD });
    const variants: Record<string, string>[] = [{}, { host: 'localhost' }, { 'x-forwarded-for': '127.0.0.1' }, { host: 'localhost', origin: 'http://localhost' }];
    for (const headers of variants) {
      const res = await call(server, 'GET', '/api/players', { remoteAddress: LOCAL, headers });
      expect(res.statusCode, JSON.stringify(headers)).toBe(401);
      expect(res.json()).toEqual({ error: 'not-signed-in' });
    }
    for (const remoteAddress of ['::1', '::ffff:127.0.0.1']) {
      expect((await call(server, 'GET', '/api/players', { remoteAddress })).statusCode, remoteAddress).toBe(401);
    }
  });

  it('reports a localhost request as signed out, with no setup', async () => {
    const server = await start({ mode: 'online', hostPassword: HOST_PASSWORD });
    const res = await call(server, 'GET', '/api/host/session', { remoteAddress: LOCAL });
    expect(res.json()).toEqual({ signedIn: false, passwordSet: true, canSetUp: false });
  });

  it('lets a localhost request sign in with the password, like any other', async () => {
    const server = await start({ mode: 'online', hostPassword: HOST_PASSWORD });
    const cookie = await signInHost(server, LOCAL);
    expect((await withCookie(server, cookie, { url: '/api/players', remoteAddress: LOCAL })).statusCode).toBe(200);
  });

  it('refuses setup from localhost', async () => {
    const server = await start({ mode: 'online', hostPassword: HOST_PASSWORD });
    const res = await call(server, 'POST', '/api/host/setup', { remoteAddress: LOCAL, payload: { password: 'another password' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
  });

  it('will not start without a host password', async () => {
    await expect(buildApp({ mode: 'online' })).rejects.toThrow(/host password/);
    await expect(buildApp({ mode: 'online', hostPassword: '' })).rejects.toThrow(/host password/);
  });
});

describe('POST /api/host/setup', () => {
  it('from the laptop, offline, sets the password, signs in, and the password then works from anywhere', async () => {
    const server = await start();
    const res = await call(server, 'POST', '/api/host/setup', { remoteAddress: LOCAL, payload: { password: HOST_PASSWORD } });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    const cookie = cookieFrom(res);
    expect((await withCookie(server, cookie, { url: '/api/players' })).statusCode).toBe(200);

    const session = await call(server, 'GET', '/api/host/session');
    expect(session.json()).toEqual({ signedIn: false, passwordSet: true, canSetUp: false });
    expect((await signIn(server, HOST_PASSWORD)).statusCode).toBe(204);
    expect((await signIn(server, 'not it at all')).statusCode).toBe(401);
  });

  it('stores only a scrypt hash of the password', async () => {
    const server = await start();
    await call(server, 'POST', '/api/host/setup', { remoteAddress: LOCAL, payload: { password: HOST_PASSWORD } });
    const row = db.prepare('SELECT password_hash FROM host_settings').get() as { password_hash: string };
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
    expect(row.password_hash).not.toContain(HOST_PASSWORD);
    expect(await verifyPin(HOST_PASSWORD, row.password_hash)).toBe(true);
  });

  it('works once: the second try is forbidden, and the password is not replaced', async () => {
    const server = await start();
    await call(server, 'POST', '/api/host/setup', { remoteAddress: LOCAL, payload: { password: HOST_PASSWORD } });
    const again = await call(server, 'POST', '/api/host/setup', { remoteAddress: LOCAL, payload: { password: 'something else' } });
    expect(again.statusCode).toBe(403);
    expect(again.json()).toEqual({ error: 'forbidden' });
    expect((await signIn(server, HOST_PASSWORD)).statusCode).toBe(204);
    expect((await signIn(server, 'something else')).statusCode).toBe(401);
  });

  it('lets only one of two setups at the same moment win', async () => {
    const server = await start();
    const results = await Promise.all([
      call(server, 'POST', '/api/host/setup', { remoteAddress: LOCAL, payload: { password: 'first password' } }),
      call(server, 'POST', '/api/host/setup', { remoteAddress: LOCAL, payload: { password: 'second password' } }),
    ]);
    expect(results.map((res) => res.statusCode).sort()).toEqual([204, 403]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM host_settings').get()).toEqual({ n: 1 });
  });

  it('is forbidden from another device, whatever the body', async () => {
    const server = await start();
    for (const payload of [{ password: HOST_PASSWORD }, {}, { password: 'x' }]) {
      const res = await call(server, 'POST', '/api/host/setup', { payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM host_settings').get()).toEqual({ n: 0 });
  });

  it('is forbidden from a page on another site or a rebound name, even from the loopback address', async () => {
    const server = await start();
    const variants: Record<string, string>[] = [{ origin: 'https://evil.example.com', host: 'localhost' }, { host: 'evil.example.com' }];
    for (const headers of variants) {
      const res = await call(server, 'POST', '/api/host/setup', { remoteAddress: LOCAL, headers, payload: { password: HOST_PASSWORD } });
      expect(res.statusCode, JSON.stringify(headers)).toBe(403);
    }
  });

  it('is forbidden when the password comes from the environment', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    const res = await call(server, 'POST', '/api/host/setup', { remoteAddress: LOCAL, payload: { password: 'another password' } });
    expect(res.statusCode).toBe(403);
    expect((await signIn(server, 'another password')).statusCode).toBe(401);
  });

  it.each([[{}], [{ password: 'short' }], [{ password: 'x'.repeat(129) }], [{ password: 12345678 }], [{ password: HOST_PASSWORD, extra: 1 }]])(
    'answers bad-request for the body %j',
    async (payload) => {
      const server = await start();
      const res = await call(server, 'POST', '/api/host/setup', { remoteAddress: LOCAL, payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
      expect(db.prepare('SELECT COUNT(*) AS n FROM host_settings').get()).toEqual({ n: 0 });
    },
  );
});

describe('POST /api/host/sign-in', () => {
  it('signs in with the right password and sets a session cookie that works', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    const res = await signIn(server, HOST_PASSWORD);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    const cookie = cookieFrom(res);
    expect(cookie.startsWith('cg_host=')).toBe(true);
    const session = await withCookie(server, cookie, { url: '/api/host/session' });
    expect(session.json()).toEqual({ signedIn: true, passwordSet: true, canSetUp: false });
    expect((await withCookie(server, cookie, { url: '/api/players' })).statusCode).toBe(200);
  });

  it('answers 401 wrong-password for a wrong password, and sets no cookie', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    const res = await signIn(server, 'not the password');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'wrong-password' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('answers 401 wrong-password when no password has been set yet', async () => {
    const server = await start();
    const res = await signIn(server, HOST_PASSWORD);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'wrong-password' });
  });

  it.each([[{}], [{ password: 1 }], [{ password: 'x'.repeat(129) }], [{ password: 'x', other: 1 }]])(
    'answers bad-request for the body %j',
    async (payload) => {
      const server = await start({ hostPassword: HOST_PASSWORD });
      const res = await call(server, 'POST', '/api/host/sign-in', { payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    },
  );

  it('gives each sign-in its own session token', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    const a = cookieFrom(await signIn(server, HOST_PASSWORD));
    const b = cookieFrom(await signIn(server, HOST_PASSWORD));
    expect(a).not.toBe(b);
    // 32 random bytes in base64url is 43 characters.
    expect(a.split('=')[1]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('stores the session as a SHA-256 hash, and the hash is not a working cookie', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    const cookie = cookieFrom(await signIn(server, HOST_PASSWORD));
    const token = cookie.split('=')[1] as string;
    const row = db.prepare('SELECT token_hash FROM host_sessions').get() as { token_hash: string };
    expect(row.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(row.token_hash).not.toBe(token);
    const stolen = await withCookie(server, `cg_host=${row.token_hash}`, { url: '/api/players' });
    expect(stolen.statusCode).toBe(401);
  });

  it('rejects a made-up or empty session cookie', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    for (const cookie of ['cg_host=garbage', 'cg_host=', 'cg_host', 'other=1']) {
      expect((await withCookie(server, cookie, { url: '/api/players' })).statusCode, cookie).toBe(401);
    }
  });
});

describe('the host cookie', () => {
  const attributes = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie']).split('; ').slice(1);

  it('is HttpOnly and SameSite=Strict, lasts 12 hours, and is not Secure over plain HTTP', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    const res = await signIn(server, HOST_PASSWORD);
    expect(attributes(res)).toEqual(['Path=/', `Max-Age=${HOST_SESSION_MS / 1000}`, 'HttpOnly', 'SameSite=Strict']);
    expect(HOST_SESSION_MS).toBe(12 * 60 * 60 * 1000);
  });

  it('is Secure when the trusted proxy says the request was HTTPS', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD, trustedProxy: '10.0.0.1' });
    const res = await signIn(server, HOST_PASSWORD, '10.0.0.1', { 'x-forwarded-proto': 'https', 'x-forwarded-for': REMOTE });
    expect(attributes(res)).toContain('Secure');
    const plain = await signIn(server, HOST_PASSWORD, '10.0.0.1', { 'x-forwarded-proto': 'http', 'x-forwarded-for': REMOTE });
    expect(attributes(plain)).not.toContain('Secure');
  });

  it('is not made Secure by a header from anyone but the trusted proxy', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD, trustedProxy: '10.0.0.1' });
    const res = await signIn(server, HOST_PASSWORD, REMOTE, { 'x-forwarded-proto': 'https' });
    expect(attributes(res)).not.toContain('Secure');
  });
});

describe('the 12-hour session', () => {
  it('works until 12 hours after sign-in and not after', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    const cookie = await signInHost(server);
    clock = START + HOST_SESSION_MS - 1;
    expect((await withCookie(server, cookie, { url: '/api/players' })).statusCode).toBe(200);
    clock = START + HOST_SESSION_MS;
    const expired = await withCookie(server, cookie, { url: '/api/players' });
    expect(expired.statusCode).toBe(401);
    expect(expired.json()).toEqual({ error: 'not-signed-in' });
    expect((await withCookie(server, cookie, { url: '/api/host/session' })).json().signedIn).toBe(false);
  });

  it('does not extend the session when it is used', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    const cookie = await signInHost(server);
    clock = START + HOST_SESSION_MS - 1000;
    await withCookie(server, cookie, { url: '/api/players' });
    clock = START + HOST_SESSION_MS;
    expect((await withCookie(server, cookie, { url: '/api/players' })).statusCode).toBe(401);
  });

  it('drops expired sessions from the table when a new one starts', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    await signInHost(server);
    clock = START + HOST_SESSION_MS + 1;
    await signInHost(server);
    expect(db.prepare('SELECT COUNT(*) AS n FROM host_sessions').get()).toEqual({ n: 1 });
  });
});

describe('POST /api/host/sign-out', () => {
  it('ends the session and clears the cookie', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    const cookie = await signInHost(server);
    const res = await withCookie(server, cookie, { method: 'POST', url: '/api/host/sign-out' });
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toContain('cg_host=');
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await withCookie(server, cookie, { url: '/api/players' })).statusCode).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS n FROM host_sessions').get()).toEqual({ n: 0 });
  });

  it('needs a host session', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    const res = await call(server, 'POST', '/api/host/sign-out');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'not-signed-in' });
  });

  it('answers 204 from the laptop offline, which stays signed in', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    expect((await call(server, 'POST', '/api/host/sign-out', { remoteAddress: LOCAL })).statusCode).toBe(204);
    expect((await call(server, 'GET', '/api/players', { remoteAddress: LOCAL })).statusCode).toBe(200);
  });
});

describe('wrong passwords are rate limited per client IP', () => {
  const wrongTries = async (server: FastifyInstance, count: number, remoteAddress = REMOTE, headers?: Record<string, string>) => {
    const codes: number[] = [];
    for (let i = 0; i < count; i++) codes.push((await signIn(server, 'wrong password', remoteAddress, headers)).statusCode);
    return codes;
  };

  it.each(['offline', 'online'] as const)('in %s mode: blocks after the limit, even for the right password', async (mode) => {
    const server = await start({ mode, hostPassword: HOST_PASSWORD });
    expect(await wrongTries(server, SIGN_IN_MAX_WRONG_PER_IP)).toEqual(Array(SIGN_IN_MAX_WRONG_PER_IP).fill(401));
    for (const password of ['wrong password', HOST_PASSWORD]) {
      const res = await signIn(server, password);
      expect(res.statusCode).toBe(429);
      expect(res.json()).toEqual({ error: 'too-many-tries' });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('keeps other addresses unaffected', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    await wrongTries(server, SIGN_IN_MAX_WRONG_PER_IP + 2);
    expect((await signIn(server, HOST_PASSWORD, '198.51.100.99')).statusCode).toBe(204);
  });

  it('lets a few mistakes through, and a right password clears the count', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    for (let round = 0; round < 2; round++) {
      await wrongTries(server, SIGN_IN_MAX_WRONG_PER_IP - 1);
      expect((await signIn(server, HOST_PASSWORD)).statusCode).toBe(204);
    }
  });

  it('lets in only the limit of guesses sent at the same moment', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    const results = await Promise.all(Array.from({ length: 30 }, () => signIn(server, 'wrong password')));
    const codes = results.map((res) => res.statusCode);
    expect(codes.filter((code) => code === 401).length).toBe(SIGN_IN_MAX_WRONG_PER_IP);
    expect(codes.filter((code) => code === 429).length).toBe(30 - SIGN_IN_MAX_WRONG_PER_IP);
  });

  it('starts over when the window ends', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    await wrongTries(server, SIGN_IN_MAX_WRONG_PER_IP);
    expect((await signIn(server, HOST_PASSWORD)).statusCode).toBe(429);
    clock = START + GUESS_WINDOW_MS;
    expect((await signIn(server, HOST_PASSWORD)).statusCode).toBe(204);
  });

  it('counts the proxy-reported client by its last X-Forwarded-For entry, not the first', async () => {
    const server = await start({ mode: 'online', hostPassword: HOST_PASSWORD, trustedProxy: '10.0.0.1' });
    for (let i = 0; i < SIGN_IN_MAX_WRONG_PER_IP; i++) {
      await signIn(server, 'wrong password', '10.0.0.1', { 'x-forwarded-for': `203.0.113.${i}, 192.0.2.50` });
    }
    expect((await signIn(server, HOST_PASSWORD, '10.0.0.1', { 'x-forwarded-for': '203.0.113.250, 192.0.2.50' })).statusCode).toBe(429);
    expect((await signIn(server, HOST_PASSWORD, '10.0.0.1', { 'x-forwarded-for': '203.0.113.250, 192.0.2.51' })).statusCode).toBe(204);
  });

  it('ignores X-Forwarded-For from anyone but the trusted proxy', async () => {
    const server = await start({ mode: 'online', hostPassword: HOST_PASSWORD });
    for (let i = 0; i < SIGN_IN_MAX_WRONG_PER_IP; i++) {
      await signIn(server, 'wrong password', REMOTE, { 'x-forwarded-for': `203.0.113.${i}` });
    }
    expect((await signIn(server, HOST_PASSWORD, REMOTE, { 'x-forwarded-for': '203.0.113.200' })).statusCode).toBe(429);
  });

  it('counts an IPv6 address by its /64, so rotating inside one range gets no fresh tries', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    for (let i = 0; i < SIGN_IN_MAX_WRONG_PER_IP; i++) await signIn(server, 'wrong password', `2001:db8:1:2::${i + 1}`);
    expect((await signIn(server, HOST_PASSWORD, '2001:db8:1:2:aaaa:bbbb:cccc:dddd')).statusCode).toBe(429);
    // The next /64 and an IPv4 address are separate clients.
    expect((await signIn(server, HOST_PASSWORD, '2001:db8:1:3::1')).statusCode).toBe(204);
    expect((await signIn(server, HOST_PASSWORD, '198.51.100.99')).statusCode).toBe(204);
  });

  it('keeps an IPv4-mapped IPv6 address per address, like plain IPv4', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    for (let i = 0; i < SIGN_IN_MAX_WRONG_PER_IP; i++) await signIn(server, 'wrong password', '::ffff:198.51.100.50');
    expect((await signIn(server, HOST_PASSWORD, '198.51.100.50')).statusCode).toBe(429);
    expect((await signIn(server, HOST_PASSWORD, '198.51.100.51')).statusCode).toBe(204);
    expect((await signIn(server, HOST_PASSWORD, '::ffff:198.51.100.52')).statusCode).toBe(204);
  });
});

describe('a host password that changes between starts', () => {
  const OLD = 'the old password';
  const NEW = 'the new password';
  let folder = '';
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  /** Starts the app on the same database file as the last start, as a restart would. */
  async function restart(options: AppOptions): Promise<FastifyInstance> {
    await app?.close();
    folder ||= mkdtempSync(join(tmpdir(), 'coliseumgrid-test-'));
    db = openDatabase(join(folder, 'test.db'));
    clock = START;
    app = await buildApp({ db, now: () => clock, ...options });
    return app;
  }

  const sessionCookie = async (server: FastifyInstance, password: string) => {
    const res = await signIn(server, password);
    expect(res.statusCode).toBe(204);
    return cookieFrom(res);
  };
  const isHost = async (server: FastifyInstance, cookie: string) =>
    (await withCookie(server, cookie, { url: '/api/players' })).statusCode === 200;

  beforeEach(() => {
    folder = '';
  });

  it('keeps sessions across a restart with the same password', async () => {
    const first = await restart({ hostPassword: OLD });
    const cookie = await sessionCookie(first, OLD);
    const second = await restart({ hostPassword: OLD });
    expect(await isHost(second, cookie)).toBe(true);
  });

  it('ends every session made under the old password, and the new password works', async () => {
    const first = await restart({ hostPassword: OLD });
    const cookie = await sessionCookie(first, OLD);
    expect(await isHost(first, cookie)).toBe(true);

    const second = await restart({ hostPassword: NEW });
    expect(await isHost(second, cookie)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM host_sessions').get()).toEqual({ n: 0 });
    expect((await signIn(second, OLD)).statusCode).toBe(401);
    expect(await isHost(second, await sessionCookie(second, NEW))).toBe(true);
  });

  it('stores the new password, so it stays the password if the variable is later removed', async () => {
    await restart({ hostPassword: OLD });
    await restart({ hostPassword: NEW });
    const third = await restart({});
    expect((await signIn(third, OLD)).statusCode).toBe(401);
    expect((await signIn(third, NEW)).statusCode).toBe(204);
  });

  it('ends sessions made under a password set from the laptop when the variable takes over', async () => {
    const first = await restart({});
    const setup = await call(first, 'POST', '/api/host/setup', { remoteAddress: LOCAL, payload: { password: OLD } });
    const cookie = cookieFrom(setup);
    expect(await isHost(first, cookie)).toBe(true);

    const second = await restart({ hostPassword: NEW });
    expect(await isHost(second, cookie)).toBe(false);
  });

  it('leaves a device paired before the change paired', async () => {
    const first = await restart({ hostPassword: OLD });
    const hostCookie = await sessionCookie(first, OLD);
    const made = await withCookie(first, hostCookie, { method: 'POST', url: '/api/pairing/codes', payload: { role: 'display' } });
    const joined = await call(first, 'POST', '/api/devices/join', { payload: { code: made.json().code } });
    const deviceCookie = cookieFrom(joined);

    const second = await restart({ hostPassword: NEW });
    expect((await withCookie(second, deviceCookie, { url: '/api/devices/me' })).statusCode).toBe(200);
  });
});

describe('what leaves the server (CLAUDE.md, rule 1)', () => {
  it('never includes a hash, a password, or a token in any host answer body', async () => {
    const server = await start({ hostPassword: HOST_PASSWORD });
    await call(server, 'GET', '/api/host/session');
    const res = await signIn(server, HOST_PASSWORD);
    await signIn(server, 'wrong password');
    const cookie = cookieFrom(res);
    const token = cookie.split('=')[1] as string;
    await withCookie(server, cookie, { method: 'POST', url: '/api/host/sign-out' });
    await call(server, 'POST', '/api/host/setup', { remoteAddress: LOCAL, payload: { password: 'another password' } });

    const all = bodies.join('\n');
    for (const leak of ['scrypt$', 'password_hash', 'passwordHash', 'token_hash', 'tokenHash', HOST_PASSWORD, token]) {
      expect(all, leak).not.toContain(leak);
    }
  });
});
