// The phone API (docs/PLAN.md, "Phone API"): signing in by handle and PIN and by follow code,
// the cap, the limits, who may call what, and the phone's one answer. Offline unless a test
// says online. PINs are hashed once for every player (phone-helpers.ts).

import { JOIN_CODE_ALPHABET, PHONE_FOLLOWS_MAX, type Bracket, type Heats, type PhoneAnswer } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { FOLLOW_CODE_MS } from '../src/follow-codes.ts';
import { CLAIM_MAX_PER_IP, CLAIM_MAX_WRONG_PER_HANDLE, CLAIM_WINDOW_MS, JOIN_MAX_WRONG_GLOBAL, JOIN_MAX_WRONG_PER_IP } from '../src/rate-limit.ts';
import { hashToken } from '../src/tokens.ts';
import { makeCallers, onStations, type Api, type Callers } from './bracket-api-helpers.ts';
import { heatsBody } from './heat-api-helpers.ts';
import { HOST_PASSWORD, cookieFrom, pairDevice, signInHost } from './helpers.ts';
import { PHONE_IP, PIN, addPinPlayers, from, handlesOf, otherIp, signInPhone } from './phone-helpers.ts';

const START = Date.parse('2027-07-10T12:00:00Z');

let app: FastifyInstance;
let db: Database;
let clock = START;
let callers: Callers;
let ids: number[];

async function start(options: AppOptions = {}): Promise<void> {
  clock = START;
  db = openDatabase(':memory:');
  app = await buildApp({ db, now: () => clock, ...options });
  await app.ready();
  ids = addPinPlayers(db, 8);
}

beforeEach(async () => {
  await start();
  callers = await makeCallers(app);
});
afterEach(() => app.close());

const nobody = (): Api => from(app, PHONE_IP);
const follow = (handle: string, pin = PIN, ip = PHONE_IP) => from(app, ip)('POST', '/api/phone/follow', { handle, pin });
const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('POST /api/phone/follow', () => {
  it('signs a phone in with the right PIN: 201, the players only, and a cg_phone cookie', async () => {
    const res = await follow('Player1');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ following: [{ id: ids[0], handle: 'Player1' }] });
    const cookie = res.headers['set-cookie'] as string;
    expect(cookie).toMatch(/^cg_phone=[A-Za-z0-9_-]{43}; /);
    for (const part of ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${400 * 24 * 60 * 60}`]) expect(cookie).toContain(part);
    // Over plain HTTP the cookie can't be Secure, or the browser would never send it back.
    expect(cookie).not.toContain('Secure');
  });

  it('stores only the SHA-256 of the token', async () => {
    const res = await follow('Player1');
    const token = cookieFrom(res).slice('cg_phone='.length);
    const rows = db.prepare('SELECT token_hash FROM phones').all();
    expect(rows).toEqual([{ token_hash: hashToken(token) }]);
    expect(JSON.stringify(db.prepare('SELECT * FROM phones').all())).not.toContain(token);
  });

  it('follows more handles from the same phone, in the order followed, and a repeat adds nothing', async () => {
    const phone = await signInPhone(app, 'Player1');
    const second = await phone.api('POST', '/api/phone/follow', { handle: 'PLAYER3', pin: PIN });
    expect(second.statusCode).toBe(201);
    expect(second.headers['set-cookie']).toBeUndefined();
    expect(handlesOf(second)).toEqual(['Player1', 'Player3']);
    const again = await phone.api('POST', '/api/phone/follow', { handle: 'Player1', pin: PIN });
    expect(handlesOf(again)).toEqual(['Player1', 'Player3']);
    expect(count('phones')).toBe(1);
    expect(count('phone_follows')).toBe(2);
  });

  it('does not need the PIN again for a handle the phone already follows', async () => {
    const phone = await signInPhone(app, 'Player1');
    const res = await phone.api('POST', '/api/phone/follow', { handle: 'Player1', pin: '0000' });
    expect(res.statusCode).toBe(201);
  });

  it('makes a second phone for a browser with no cookie, and a phone of its own for each', async () => {
    await follow('Player1');
    await follow('Player1', PIN, otherIp(2));
    expect(count('phones')).toBe(2);
  });

  it('does not mark the player as at the event, which the tablet claim does', async () => {
    await follow('Player1');
    expect((await callers.host('GET', '/api/event/players')).json()).toEqual({ playerIds: [] });
  });

  it('answers 401 wrong-pin for a wrong PIN and for something that is not a PIN, and signs nobody in', async () => {
    for (const pin of ['0000', 'abcd', '', '12345']) {
      const res = await follow('Player1', pin);
      expect(res.statusCode, pin).toBe(401);
      expect(res.json()).toEqual({ error: 'wrong-pin' });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect(count('phones')).toBe(0);
  });

  it('answers 404 not-found for a handle nobody has', async () => {
    const res = await follow('Nobody');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not-found' });
  });

  it('refuses a handle the filter refuses, whatever the PIN, as the claim route does', async () => {
    const res = await follow('FUCK');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'refused', reason: 'not-allowed' });
    expect((await follow('A')).json()).toEqual({ error: 'refused', reason: 'too-short' });
  });

  it.each([
    ['no handle', { pin: PIN }],
    ['no pin', { handle: 'Player1' }],
    ['a number for the pin', { handle: 'Player1', pin: 1234 }],
    ['a field the contract does not list', { handle: 'Player1', pin: PIN, extra: 1 }],
    ['an empty body', {}],
  ])('answers bad-request for %s', async (_name, body) => {
    const res = await nobody()('POST', '/api/phone/follow', body as object);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });

  it('answers 409 too-many-handles for a 7th handle, and keeps the 6', async () => {
    const phone = await signInPhone(app, 'Player1');
    for (let i = 2; i <= PHONE_FOLLOWS_MAX; i++) {
      expect((await phone.api('POST', '/api/phone/follow', { handle: `Player${i}`, pin: PIN })).statusCode).toBe(201);
    }
    const res = await phone.api('POST', '/api/phone/follow', { handle: 'Player7', pin: PIN });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'too-many-handles' });
    expect(count('phone_follows')).toBe(PHONE_FOLLOWS_MAX);
  });

  it('is not rejected for a handle that is one of the 6 already followed', async () => {
    const phone = await signInPhone(app, 'Player1');
    for (let i = 2; i <= PHONE_FOLLOWS_MAX; i++) await phone.api('POST', '/api/phone/follow', { handle: `Player${i}`, pin: PIN });
    expect((await phone.api('POST', '/api/phone/follow', { handle: 'Player6', pin: PIN })).statusCode).toBe(201);
  });
});

describe('the PIN limits', () => {
  it('locks a handle after 5 wrong PINs, even for the right one, and a right PIN before that clears the count', async () => {
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE - 1; i++) expect((await follow('Player1', '0000')).statusCode).toBe(401);
    expect((await follow('Player1')).statusCode).toBe(201);
    // The count started over, so 5 more wrong ones are allowed and the 6th try is refused.
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE; i++) expect((await follow('Player1', '0000', otherIp(5))).statusCode).toBe(401);
    const locked = await follow('Player1', PIN, otherIp(6));
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toEqual({ error: 'too-many-tries' });
    // Another handle is not affected.
    expect((await follow('Player2', PIN, otherIp(6))).statusCode).toBe(201);
  });

  it('lets the handle in again once the window has passed', async () => {
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE; i++) await follow('Player1', '0000');
    expect((await follow('Player1')).statusCode).toBe(429);
    clock += CLAIM_WINDOW_MS + 1;
    expect((await follow('Player1')).statusCode).toBe(201);
  });

  it('limits a phone offline too, though the tablet is not limited there', async () => {
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE + 5; i++) {
      expect((await callers.signup('POST', '/api/signup/claim', { handle: 'Player1', pin: '0000' })).statusCode).toBe(401);
    }
    // The tablet's wrong tries are not counted offline, so the phone still has its 5.
    expect((await follow('Player1')).statusCode).toBe(201);
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE; i++) await follow('Player2', '0000');
    expect((await follow('Player2')).statusCode).toBe(429);
    expect((await callers.signup('POST', '/api/signup/claim', { handle: 'Player2', pin: PIN })).statusCode).toBe(200);
  });

  it('counts every try from one address, wrong or right, and an unknown handle too', async () => {
    for (let i = 0; i < CLAIM_MAX_PER_IP; i++) {
      const handle = i % 2 === 0 ? 'Player1' : 'Nobody';
      expect((await follow(handle)).statusCode).not.toBe(429);
    }
    const res = await follow('Player2');
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'too-many-tries' });
    expect((await follow('Player2', PIN, otherIp(9))).statusCode).toBe(201);
    clock += CLAIM_WINDOW_MS + 1;
    expect((await follow('Player3')).statusCode).toBe(201);
  });
});

describe('the PIN limits online', () => {
  beforeEach(async () => {
    await app.close();
    await start({ mode: 'online', hostPassword: HOST_PASSWORD });
  });

  it('shares the wrong-PIN count of a handle between the tablet and the phone: 5 in all', async () => {
    const host = await signInHost(app);
    const { cookie } = await pairDevice(app, host, 'signup');
    const tablet = from(app, otherIp(3), cookie);
    for (let i = 0; i < 3; i++) expect((await tablet('POST', '/api/signup/claim', { handle: 'Player1', pin: '0000' })).statusCode).toBe(401);
    for (let i = 0; i < 2; i++) expect((await follow('Player1', '0000')).statusCode).toBe(401);
    // 5 wrong in all: both routes now refuse, the right PIN included.
    expect((await follow('Player1')).statusCode).toBe(429);
    expect((await tablet('POST', '/api/signup/claim', { handle: 'Player1', pin: PIN })).statusCode).toBe(429);
    // The count is per handle.
    expect((await tablet('POST', '/api/signup/claim', { handle: 'Player2', pin: PIN })).statusCode).toBe(200);
    clock += CLAIM_WINDOW_MS + 1;
    expect((await follow('Player1')).statusCode).toBe(201);
  });

  it('counts the other way round too: phone tries lock out the tablet', async () => {
    const host = await signInHost(app);
    const { cookie } = await pairDevice(app, host, 'signup');
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE; i++) await follow('Player1', '0000', otherIp(20 + i));
    const res = await from(app, otherIp(3), cookie)('POST', '/api/signup/claim', { handle: 'Player1', pin: PIN });
    expect(res.statusCode).toBe(429);
  });

  it('makes the cookie Secure when the request came over HTTPS through the trusted proxy', async () => {
    await app.close();
    await start({ mode: 'online', hostPassword: HOST_PASSWORD, trustedProxy: '10.0.0.9' });
    const viaProxy = (proto: string, peer = '10.0.0.9') =>
      from(app, peer, undefined, { 'x-forwarded-proto': proto, 'x-forwarded-for': '203.0.113.50' })('POST', '/api/phone/follow', { handle: 'Player1', pin: PIN });
    expect(((await viaProxy('https')).headers['set-cookie'] as string)).toContain('Secure');
    expect(((await viaProxy('http')).headers['set-cookie'] as string)).not.toContain('Secure');
    // A caller that isn't the proxy can't claim HTTPS.
    expect(((await viaProxy('https', '203.0.113.50')).headers['set-cookie'] as string)).not.toContain('Secure');
  });
});

describe('follow codes', () => {
  /** Signs a player up at the tablet and returns the code the Done screen would show. */
  async function codeFor(handle: string): Promise<string> {
    const res = await callers.signup('POST', '/api/signup', { handle, pin: PIN });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().followCode.code;
  }
  const redeem = (code: string, ip = PHONE_IP, api: Api = from(app, ip)) => api('POST', '/api/phone/follow-code', { code });

  it('comes with a sign-up and works once: 201 with the player and a cookie, then 404 wrong-code', async () => {
    const sign = await callers.signup('POST', '/api/signup', { handle: 'Zap', pin: PIN });
    const { code, expiresAt } = sign.json().followCode;
    expect(code).toMatch(new RegExp(`^[${JOIN_CODE_ALPHABET}]{6}$`));
    expect(expiresAt).toBe(new Date(START + FOLLOW_CODE_MS).toISOString());
    const res = await redeem(code);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ following: [sign.json().player] });
    expect(res.headers['set-cookie']).toContain('cg_phone=');
    const again = await redeem(code, otherIp(2));
    expect(again.statusCode).toBe(404);
    expect(again.json()).toEqual({ error: 'wrong-code' });
  });

  it('comes with a claim, and only after the PIN was proven', async () => {
    const wrong = await callers.signup('POST', '/api/signup/claim', { handle: 'Player1', pin: '0000' });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'wrong-pin' });
    expect(count('follow_codes')).toBe(0);
    const right = await callers.signup('POST', '/api/signup/claim', { handle: 'Player1', pin: PIN });
    expect(Object.keys(right.json()).sort()).toEqual(['followCode', 'player']);
    expect((await redeem(right.json().followCode.code)).json()).toEqual({ following: [{ id: ids[0], handle: 'Player1' }] });
  });

  it('is not made by a sign-up that fails, or by the host adding a player', async () => {
    await callers.signup('POST', '/api/signup', { handle: 'Player1', pin: PIN });
    await callers.signup('POST', '/api/signup', { handle: 'FUCK', pin: PIN });
    await callers.signup('POST', '/api/signup', { handle: 'Fresh', pin: 'abcd' });
    await callers.host('POST', '/api/players', { handle: 'Added' });
    expect(count('follow_codes')).toBe(0);
  });

  it('expires after 10 minutes', async () => {
    const code = await codeFor('Zap');
    clock += FOLLOW_CODE_MS;
    expect((await redeem(code)).statusCode).toBe(404);
  });

  it('works up to the last moment', async () => {
    const code = await codeFor('Zap');
    clock += FOLLOW_CODE_MS - 1;
    expect((await redeem(code)).statusCode).toBe(201);
  });

  it('is replaced by the next code for the same player', async () => {
    const first = await codeFor('Zap');
    const second = (await callers.signup('POST', '/api/signup/claim', { handle: 'Zap', pin: PIN })).json().followCode.code;
    expect((await redeem(first)).statusCode).toBe(404);
    expect((await redeem(second, otherIp(2))).statusCode).toBe(201);
  });

  it('reads a code as typed: any case, spaces, hyphens, and S Z B U for the characters they look like', async () => {
    const code = await codeFor('Zap');
    const typed = `${code.slice(0, 3)}-${code.slice(3)}`.toLowerCase();
    expect((await redeem(typed)).statusCode).toBe(201);
  });

  it.each(['', 'ABC', 'AAAAAAA', 'OOOOOO', '111111'])('answers 404 wrong-code for the code "%s"', async (code) => {
    const res = await redeem(code);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'wrong-code' });
  });

  it('answers bad-request for a body that is not { code }', async () => {
    for (const body of [{}, { code: 5 }, { code: 'AAAAAA', x: 1 }, { code: 'A'.repeat(65) }]) {
      const res = await nobody()('POST', '/api/phone/follow-code', body as object);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
  });

  it('adds to a phone that is signed in, and answers 409 without spending the code when it follows 6', async () => {
    const phone = await signInPhone(app, 'Player1');
    const code = await codeFor('Zap');
    expect(handlesOf(await redeem(code, PHONE_IP, phone.api))).toEqual(['Player1', 'Zap']);
    for (let i = 2; i <= PHONE_FOLLOWS_MAX - 1; i++) await phone.api('POST', '/api/phone/follow', { handle: `Player${i}`, pin: PIN });
    const spare = await codeFor('Spare');
    const full = await redeem(spare, PHONE_IP, phone.api);
    expect(full.statusCode).toBe(409);
    expect(full.json()).toEqual({ error: 'too-many-handles' });
    // The code is still good for another phone.
    expect((await redeem(spare, otherIp(4))).statusCode).toBe(201);
  });

  it('is limited to 10 wrong codes per address in a window, the right code included, and a right one clears the count', async () => {
    const code = await codeFor('Zap');
    for (let i = 0; i < JOIN_MAX_WRONG_PER_IP - 1; i++) expect((await redeem('AAAAAA')).statusCode).toBe(404);
    expect((await redeem(code)).statusCode).toBe(201);
    for (let i = 0; i < JOIN_MAX_WRONG_PER_IP; i++) expect((await redeem('AAAAAA')).statusCode).toBe(404);
    const other = await codeFor('Bolt');
    const locked = await redeem(other);
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toEqual({ error: 'too-many-tries' });
    expect((await redeem(other, otherIp(7))).statusCode).toBe(201);
  });

  it('is limited across all callers: 100 wrong codes from many addresses stop every address', async () => {
    const code = await codeFor('Zap');
    for (let i = 0; i < JOIN_MAX_WRONG_GLOBAL; i++) {
      expect((await redeem('AAAAAA', `203.0.${Math.floor(i / 10)}.${i % 10 + 1}`)).statusCode).toBe(404);
    }
    expect((await redeem(code, otherIp(99))).statusCode).toBe(429);
    clock += CLAIM_WINDOW_MS + 1;
    // The window is over; the code lasted as long, so a new one is needed.
    const fresh = (await callers.signup('POST', '/api/signup/claim', { handle: 'Zap', pin: PIN })).json().followCode.code;
    expect((await redeem(fresh, otherIp(99))).statusCode).toBe(201);
  });

  it('shares its limits with the pairing codes: wrong codes of either kind count together', async () => {
    const code = await codeFor('Zap');
    for (let i = 0; i < JOIN_MAX_WRONG_PER_IP; i++) {
      expect((await from(app, PHONE_IP)('POST', '/api/devices/join', { code: 'AAAAAA' })).statusCode).toBe(404);
    }
    expect((await redeem(code)).statusCode).toBe(429);
    const pairing = (await callers.host('POST', '/api/pairing/codes', { role: 'display' })).json().code;
    expect((await from(app, PHONE_IP)('POST', '/api/devices/join', { code: pairing })).statusCode).toBe(429);
  });

  it('is dropped with a player, and a spent or expired code is cleaned up by the next one', async () => {
    const first = await codeFor('Zap');
    await redeem(first);
    clock += FOLLOW_CODE_MS + 1;
    await codeFor('Bolt');
    expect(count('follow_codes')).toBe(1);
  });
});

describe('who may call which route', () => {
  let phone: Phone;
  type Phone = Awaited<ReturnType<typeof signInPhone>>;
  beforeEach(async () => {
    phone = await signInPhone(app, 'Player1');
  });

  const HOST_ROUTES: [string, string, object?][] = [
    ['GET', '/api/players'],
    ['POST', '/api/players', { handle: 'Added' }],
    ['PATCH', '/api/players/1', { handle: 'Renamed' }],
    ['POST', '/api/players/1/merge', { intoId: 2 }],
    ['POST', '/api/players/1/reset-pin'],
    ['GET', '/api/devices'],
    ['DELETE', '/api/devices/1'],
    ['POST', '/api/pairing/codes', { role: 'display' }],
    ['PUT', '/api/event', { name: 'Friday' }],
    ['GET', '/api/event/players'],
    ['GET', '/api/bracket'],
    ['POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: [1, 2] }],
    ['POST', '/api/bracket/results', { matchId: 0, winnerId: 1 }],
    ['POST', '/api/bracket/undo', { resultId: 1 }],
    ['POST', '/api/bracket/players', { playerId: 1 }],
    ['POST', '/api/bracket/tie-break'],
    ['DELETE', '/api/bracket'],
    ['GET', '/api/heats'],
    ['POST', '/api/heats', heatsBody([1, 2, 3, 4])],
    ['POST', '/api/heats/results', { heatId: 1, order: [1, 2] }],
    ['POST', '/api/heats/undo', { resultId: 1 }],
    ['POST', '/api/heats/players', { playerId: 1 }],
    ['POST', '/api/heats/tie-break'],
    ['DELETE', '/api/heats'],
    ['POST', '/api/host/sign-out'],
  ];
  const SIGNUP_ROUTES: [string, string, object][] = [
    ['POST', '/api/signup/check', { handle: 'Fresh' }],
    ['POST', '/api/signup', { handle: 'Fresh', pin: PIN }],
    ['POST', '/api/signup/claim', { handle: 'Player2', pin: PIN }],
  ];

  it.each(HOST_ROUTES)('refuses a phone on the host route %s %s with 401 not-signed-in', async (method, url, body) => {
    const res = await phone.api(method as 'GET', url, body);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'not-signed-in' });
  });

  it.each(SIGNUP_ROUTES)('refuses a phone on the sign-up route %s %s with 401 not-signed-in', async (method, url, body) => {
    const res = await phone.api(method as 'POST', url, body);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'not-signed-in' });
  });

  it('does not make a phone of a host, a Display, or a Sign-up device, nor the other way round', async () => {
    // The phone's cookie doesn't count as a device cookie, and a device's isn't a phone's.
    expect((await callers.display('GET', '/api/phone')).statusCode).toBe(401);
    expect((await callers.signup('GET', '/api/phone')).statusCode).toBe(401);
    expect((await callers.host('GET', '/api/phone')).statusCode).toBe(401);
    expect((await phone.api('GET', '/api/devices/me')).json()).toEqual({ error: 'not-paired' });
    expect((await phone.api('GET', '/api/host/session')).json().signedIn).toBe(false);
  });

  const PHONE_ROUTES: [string, string, object?][] = [
    ['GET', '/api/phone'],
    ['DELETE', '/api/phone/follow/1'],
    ['POST', '/api/phone/sign-out'],
    ['GET', '/api/phone/push'],
    ['PUT', '/api/phone/push', { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } }],
    ['DELETE', '/api/phone/push'],
  ];

  it.each(PHONE_ROUTES)('refuses the host, a Display, a Sign-up device, and a stranger on %s %s with 401 not-following', async (method, url, body) => {
    for (const who of ['host', 'display', 'signup', 'nobody'] as const) {
      const res = await callers[who](method as 'GET', url, body);
      expect(res.statusCode, who).toBe(401);
      expect(res.json(), who).toEqual({ error: 'not-following' });
    }
    expect((await from(app, PHONE_IP, 'cg_phone=garbage')(method as 'GET', url, body)).statusCode).toBe(401);
  });

  it('lets a phone read the event, and refuses a stranger', async () => {
    await callers.host('PUT', '/api/event', { name: 'Friday' });
    const res = await phone.api('GET', '/api/event');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ event: { name: 'Friday' } });
    expect((await nobody()('GET', '/api/event')).statusCode).toBe(401);
  });

  it('lets anyone sign in a phone, including a Display or a Sign-up device browser', async () => {
    expect((await callers.display('POST', '/api/phone/follow', { handle: 'Player2', pin: PIN })).statusCode).toBe(201);
    expect((await callers.signup('POST', '/api/phone/follow', { handle: 'Player3', pin: PIN })).statusCode).toBe(201);
  });

  it('refuses a stale phone: after sign-out its cookie opens nothing', async () => {
    await phone.api('POST', '/api/phone/sign-out');
    expect((await phone.api('GET', '/api/phone')).statusCode).toBe(401);
    expect((await phone.api('GET', '/api/event')).statusCode).toBe(401);
  });

  it('applies the Origin rule to every phone route that changes something', async () => {
    const foreign = { cookie: phone.cookie, origin: 'http://evil.example.com', host: 'localhost' };
    const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
      app.inject({ method, url, remoteAddress: PHONE_IP, headers: foreign, ...(payload && { payload }) });
    for (const [method, url, body] of [
      ['POST', '/api/phone/follow', { handle: 'Player2', pin: PIN }],
      ['POST', '/api/phone/follow-code', { code: 'AAAAAA' }],
      ['POST', '/api/phone/sign-out'],
      ['DELETE', '/api/phone/follow/1'],
      ['PUT', '/api/phone/push', { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } }],
      ['DELETE', '/api/phone/push'],
    ] as const) {
      const res = await send(method, url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
    }
    // The phone is still signed in with its follow.
    expect(handlesOf(await phone.api('POST', '/api/phone/follow', { handle: 'Player1', pin: PIN }))).toEqual(['Player1']);
    // The same origin as the Host passes.
    const same = await app.inject({
      method: 'POST', url: '/api/phone/follow', remoteAddress: PHONE_IP,
      headers: { origin: 'http://localhost', host: 'localhost' }, payload: { handle: 'Player2', pin: PIN },
    });
    expect(same.statusCode).toBe(201);
  });
});

describe('unfollowing and signing out', () => {
  it('stops following one player, and the last one signs the phone out: cookie cleared, rows gone', async () => {
    const phone = await signInPhone(app, 'Player1');
    await phone.api('POST', '/api/phone/follow', { handle: 'Player2', pin: PIN });
    const one = await phone.api('DELETE', `/api/phone/follow/${ids[0]}`);
    expect(one.statusCode).toBe(200);
    expect(one.json()).toEqual({ following: [{ id: ids[1], handle: 'Player2' }] });
    expect(one.headers['set-cookie']).toBeUndefined();
    const last = await phone.api('DELETE', `/api/phone/follow/${ids[1]}`);
    expect(last.json()).toEqual({ following: [] });
    expect(last.headers['set-cookie']).toContain('Max-Age=0');
    expect(count('phones')).toBe(0);
    expect(count('phone_follows')).toBe(0);
    expect((await phone.api('GET', '/api/phone')).statusCode).toBe(401);
  });

  it('answers 404 not-found for a player the phone does not follow, and 400 for a bad id', async () => {
    const phone = await signInPhone(app, 'Player1');
    const res = await phone.api('DELETE', `/api/phone/follow/${ids[3]}`);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not-found' });
    for (const bad of ['0', 'abc', '-1', '1.5']) {
      const res2 = await phone.api('DELETE', `/api/phone/follow/${bad}`);
      expect(res2.statusCode, bad).toBe(400);
      expect(res2.json()).toEqual({ error: 'bad-request' });
    }
    expect(count('phone_follows')).toBe(1);
  });

  it('leaves another phone following the same player alone', async () => {
    const a = await signInPhone(app, 'Player1');
    const b = await signInPhone(app, 'Player1', otherIp(2));
    await a.api('DELETE', `/api/phone/follow/${ids[0]}`);
    expect(((await b.api('GET', '/api/phone')).json() as PhoneAnswer).following.map((f) => f.player.handle)).toEqual(['Player1']);
    expect((await a.api('GET', '/api/phone')).statusCode).toBe(401);
  });

  it('signs out with 204, clears the cookie, and removes the phone with its follows and push subscription', async () => {
    const phone = await signInPhone(app, 'Player1');
    db.prepare("INSERT INTO push_subscriptions (phone_id, endpoint, p256dh, auth, created_at) VALUES (1, 'e', 'p', 'a', 't')").run();
    const res = await phone.api('POST', '/api/phone/sign-out');
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(res.headers['set-cookie']).toContain('cg_phone=x');
    expect(res.headers['set-cookie']).toContain('Max-Age=0');
    for (const table of ['phones', 'phone_follows', 'push_subscriptions']) expect(count(table), table).toBe(0);
    // The players are still there.
    expect(count('players')).toBe(8);
  });
});

describe('GET /api/phone', () => {
  const PLAYER_KEYS = ['handle', 'id'];
  const keysOf = (value: object): string[] => Object.keys(value).sort();

  /** Checks the answer lists only the contract's fields, and a player only as { id, handle }. */
  function expectShape(answer: PhoneAnswer): void {
    expect(keysOf(answer)).toEqual(['event', 'following', 'standings']);
    for (const f of answer.following) {
      expect(keysOf(f)).toEqual(['away', 'matchId', 'others', 'place', 'player', 'station', 'status']);
      expect(keysOf(f.player)).toEqual(PLAYER_KEYS);
      for (const o of f.others) expect(keysOf(o)).toEqual(PLAYER_KEYS);
    }
    if (answer.standings?.kind === 'bracket') {
      expect(keysOf(answer.standings)).toEqual(['finished', 'format', 'kind', 'rows']);
      for (const row of answer.standings.rows) {
        expect(keysOf(row)).toEqual(['losses', 'place', 'player', 'wins']);
        expect(keysOf(row.player)).toEqual(PLAYER_KEYS);
      }
    } else if (answer.standings) {
      expect(keysOf(answer.standings)).toEqual(['finalSize', 'finished', 'kind', 'rows']);
      for (const row of answer.standings.rows) {
        expect(keysOf(row)).toEqual(['heatsPlayed', 'place', 'player', 'points']);
        expect(keysOf(row.player)).toEqual(PLAYER_KEYS);
      }
    }
  }

  it('answers before any event: no event, the followed player not in anything, no standings', async () => {
    const phone = await signInPhone(app, 'Player1');
    const res = await phone.api('GET', '/api/phone');
    expect(res.statusCode).toBe(200);
    const answer = res.json() as PhoneAnswer;
    expect(answer).toEqual({
      event: null,
      following: [{ player: { id: ids[0], handle: 'Player1' }, status: 'not-in', away: null, station: null, matchId: null, others: [], place: null }],
      standings: null,
    });
    expectShape(answer);
  });

  it('tells where each followed player stands in a bracket, and gives everyone standings', async () => {
    await callers.host('PUT', '/api/event', { name: 'Friday' });
    const made = (await callers.host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 6) })).json().bracket as Bracket;
    const onStation = onStations(made)[0]!;
    const playing = onStation.slots[0].player!;
    const waiting = made.upNext[0]!.slots[0].player!;
    const outsider = ids[7]!;
    const phone = await signInPhone(app, playing.handle);
    await phone.api('POST', '/api/phone/follow', { handle: waiting.handle, pin: PIN });
    await phone.api('POST', '/api/phone/follow', { handle: 'Player8', pin: PIN });
    const answer = (await phone.api('GET', '/api/phone')).json() as PhoneAnswer;
    expectShape(answer);
    expect(answer.event).toEqual({ name: 'Friday' });
    const [a, b, c] = answer.following;
    expect(a).toMatchObject({ player: playing, status: 'now', away: 0, station: 1, matchId: onStation.id, others: [onStation.slots[1].player] });
    expect(b).toMatchObject({ player: waiting, status: 'next', away: 1, station: null, matchId: made.upNext[0]!.id });
    expect(c).toMatchObject({ player: { id: outsider, handle: 'Player8' }, status: 'not-in', away: null, matchId: null, others: [] });
    expect(answer.standings).toEqual({ kind: 'bracket', format: 'single', finished: false, rows: made.standings });
  });

  it('tells where a followed player stands in heats, and gives the heats standings and final size', async () => {
    const made = (await callers.host('POST', '/api/heats', heatsBody(ids.slice(0, 6), { stations: 1 }))).json().heats as Heats;
    const heat = made.stations[0]!.heat!;
    const player = heat.players[0]!;
    const phone = await signInPhone(app, player.handle);
    const answer = (await phone.api('GET', '/api/phone')).json() as PhoneAnswer;
    expectShape(answer);
    expect(answer.following[0]).toMatchObject({ player, status: 'now', station: 1, matchId: heat.id, away: 0 });
    expect(answer.following[0]!.others).toEqual(heat.players.filter((p) => p.id !== player.id));
    expect(answer.standings).toEqual({ kind: 'heats', finished: false, rows: made.standings, finalSize: made.finalSize });
  });

  it('shows the handle a player has now, after a rename', async () => {
    const phone = await signInPhone(app, 'Player1');
    await callers.host('PATCH', `/api/players/${ids[0]}`, { handle: 'Renamed' });
    const answer = (await phone.api('GET', '/api/phone')).json() as PhoneAnswer;
    expect(answer.following[0]!.player).toEqual({ id: ids[0], handle: 'Renamed' });
  });

  it('never carries a hash, a token, a key, or a time', async () => {
    const phone = await signInPhone(app, 'Player1');
    await callers.signup('POST', '/api/signup', { handle: 'Zap', pin: PIN });
    const bodies = [
      (await phone.api('GET', '/api/phone')).body,
      (await phone.api('GET', '/api/phone/push')).body,
      (await phone.api('GET', '/api/event')).body,
      (await phone.api('POST', '/api/phone/follow', { handle: 'Zap', pin: PIN })).body,
      (await phone.api('DELETE', `/api/phone/follow/${ids[0]}`)).body,
    ].join('\n');
    for (const leak of ['pin_hash', 'pinHash', 'handle_key', 'token', 'created_at', 'last_seen', 'scrypt$', 'endpoint', 'p256dh']) {
      expect(bodies, leak).not.toContain(leak);
    }
  });
});

describe('PIN reset and merge', () => {
  it('removes the player from every phone that followed them, and signs out a phone left following nobody', async () => {
    const both = await signInPhone(app, 'Player1');
    await both.api('POST', '/api/phone/follow', { handle: 'Player2', pin: PIN });
    const only = await signInPhone(app, 'Player1', otherIp(2));
    const other = await signInPhone(app, 'Player3', otherIp(3));
    db.prepare("INSERT INTO push_subscriptions (phone_id, endpoint, p256dh, auth, created_at) VALUES (2, 'e', 'p', 'a', 't')").run();
    const res = await callers.host('POST', `/api/players/${ids[0]}/reset-pin`);
    expect(res.statusCode).toBe(200);
    expect(((await both.api('GET', '/api/phone')).json() as PhoneAnswer).following.map((f) => f.player.handle)).toEqual(['Player2']);
    expect((await only.api('GET', '/api/phone')).statusCode).toBe(401);
    expect(((await other.api('GET', '/api/phone')).json() as PhoneAnswer).following).toHaveLength(1);
    expect(count('phones')).toBe(2);
    expect(count('push_subscriptions')).toBe(0);
  });

  it('needs the new PIN to follow the player again, and the old PIN no longer works', async () => {
    await signInPhone(app, 'Player1');
    const reset = (await callers.host('POST', `/api/players/${ids[0]}/reset-pin`)).json().pin as string;
    expect((await follow('Player1', PIN === reset ? '0000' : PIN, otherIp(2))).statusCode).toBe(401);
    expect((await follow('Player1', reset, otherIp(3))).statusCode).toBe(201);
  });

  it('kills a follow code made with the old PIN', async () => {
    const code = (await callers.signup('POST', '/api/signup/claim', { handle: 'Player1', pin: PIN })).json().followCode.code;
    await callers.host('POST', `/api/players/${ids[0]}/reset-pin`);
    expect((await from(app, PHONE_IP)('POST', '/api/phone/follow-code', { code })).statusCode).toBe(404);
  });

  it('leaves the phones alone when the reset fails (unknown player)', async () => {
    await signInPhone(app, 'Player1');
    expect((await callers.host('POST', '/api/players/999/reset-pin')).statusCode).toBe(404);
    expect(count('phone_follows')).toBe(1);
  });

  it('moves the follows of a merged player to the one kept, and keeps one row for a phone that followed both', async () => {
    const onlyMerged = await signInPhone(app, 'Player1');
    const both = await signInPhone(app, 'Player1', otherIp(2));
    await both.api('POST', '/api/phone/follow', { handle: 'Player2', pin: PIN });
    const res = await callers.host('POST', `/api/players/${ids[0]}/merge`, { intoId: ids[1] });
    expect(res.statusCode).toBe(200);
    const a = (await onlyMerged.api('GET', '/api/phone')).json() as PhoneAnswer;
    expect(a.following.map((f) => f.player)).toEqual([{ id: ids[1], handle: 'Player2' }]);
    const b = (await both.api('GET', '/api/phone')).json() as PhoneAnswer;
    expect(b.following.map((f) => f.player)).toEqual([{ id: ids[1], handle: 'Player2' }]);
    expect(count('phones')).toBe(2);
    expect(count('phone_follows')).toBe(2);
  });

  it('drops the merged player\'s follow codes with them', async () => {
    const code = (await callers.signup('POST', '/api/signup/claim', { handle: 'Player1', pin: PIN })).json().followCode.code;
    await callers.host('POST', `/api/players/${ids[0]}/merge`, { intoId: ids[1] });
    expect(count('follow_codes')).toBe(0);
    expect((await from(app, PHONE_IP)('POST', '/api/phone/follow-code', { code })).statusCode).toBe(404);
  });

  it('keeps a merge refused for a player in a bracket from touching the follows', async () => {
    await signInPhone(app, 'Player1');
    await callers.host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 4) });
    const res = await callers.host('POST', `/api/players/${ids[0]}/merge`, { intoId: ids[5] });
    expect(res.statusCode).toBe(409);
    expect(count('phone_follows')).toBe(1);
  });
});

describe('what a phone cannot reach', () => {
  it('has a bracket and heats the phone can only see through its own answer', async () => {
    await callers.host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 4) });
    const phone = await signInPhone(app, 'Player1');
    expect((await phone.api('GET', '/api/bracket')).statusCode).toBe(401);
    expect((await phone.api('GET', '/api/players')).statusCode).toBe(401);
    expect(((await phone.api('GET', '/api/phone')).json() as PhoneAnswer).standings?.kind).toBe('bracket');
  });
});
