// Push for phones (docs/PLAN.md, "Player view", "Push"): offered only online over HTTPS, the
// subscription routes, and the alert sent when a followed player is called or comes up next.
// The sender is a fake the test hands in: how a push is encrypted and sent is web-push.ts's own
// tests. The proxy is 10.0.0.9, and a request is HTTPS when it comes from it with
// X-Forwarded-Proto: https (CLAUDE.md, rule 6).

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bracket, Heats } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type AppOptions } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import type { PushPayload, PushSender } from '../src/push-notify.ts';
import type { PushOutcome, PushSubscriptionRecord, VapidConfig } from '../src/web-push.ts';
import { makeCallers, onStations, type Api } from './bracket-api-helpers.ts';
import { heatsBody } from './heat-api-helpers.ts';
import { HOST_PASSWORD, REMOTE, signInHost } from './helpers.ts';
import { PIN, addPinPlayers, from, otherIp } from './phone-helpers.ts';

const PROXY = '10.0.0.9';
const SUBJECT = 'mailto:host@example.com';
const FCM = 'https://fcm.googleapis.com/fcm/send/';
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PUBLIC_KEY = 'B-test-public-key';

interface Sent {
  sub: PushSubscriptionRecord;
  payload: PushPayload;
  vapid: VapidConfig;
}

let app: FastifyInstance;
let db: Database;
let ids: number[];
let host: Api;
let sent: Sent[];
let outcome: (sub: PushSubscriptionRecord) => PushOutcome | Promise<PushOutcome>;
const loadKeys = vi.fn((_dir: string) => ({ publicKey: PUBLIC_KEY, privateKey }));
const warnings: string[] = [];

const send: PushSender = async (sub, payload, vapid) => {
  sent.push({ sub, payload: JSON.parse(payload) as PushPayload, vapid });
  return outcome(sub);
};

/** A valid browser subscription: a 65-byte point starting 0x04 and a 16-byte secret. */
const subscription = (n: number) => ({
  endpoint: `${FCM}${n}`,
  keys: {
    p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  },
});

async function start(options: AppOptions = {}): Promise<void> {
  db = openDatabase(':memory:');
  app = await buildApp({
    db,
    mode: 'online',
    hostPassword: HOST_PASSWORD,
    trustedProxy: PROXY,
    push: { subject: SUBJECT, dataDir: '/data', loadKeys, send },
    ...options,
  });
  await app.ready();
  host = from(app, REMOTE, await signInHost(app, REMOTE));
  ids = addPinPlayers(db, 8);
}

beforeEach(async () => {
  sent = [];
  warnings.length = 0;
  outcome = () => 'sent';
  loadKeys.mockClear();
  await start();
});
afterEach(() => app.close());

/** A request from the proxy for a client at `ip`, over HTTPS unless told otherwise. */
const viaProxy = (cookie?: string, ip = '203.0.113.50', proto: string | null = 'https'): Api =>
  from(app, PROXY, cookie, { 'x-forwarded-for': ip, ...(proto && { 'x-forwarded-proto': proto }) });

async function signIn(handle: string, ip = '203.0.113.50'): Promise<{ api: Api; cookie: string }> {
  const res = await viaProxy(undefined, ip)('POST', '/api/phone/follow', { handle, pin: PIN });
  expect(res.statusCode, res.body).toBe(201);
  const cookie = (res.headers['set-cookie'] as string).split(';')[0]!;
  return { api: viaProxy(cookie, ip), cookie };
}

const rows = (table: string) => db.prepare(`SELECT * FROM ${table}`).all();

describe('GET /api/phone/push', () => {
  it('gives the public key over HTTPS through the proxy, loading the keys from the data folder once', async () => {
    const phone = await signIn('Player1');
    expect(loadKeys).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) {
      const res = await phone.api('GET', '/api/phone/push');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ publicKey: PUBLIC_KEY });
    }
    expect(loadKeys).toHaveBeenCalledTimes(1);
    expect(loadKeys).toHaveBeenCalledWith('/data');
  });

  it('gives null, and loads nothing, over plain HTTP: a missing or http X-Forwarded-Proto', async () => {
    const phone = await signIn('Player1');
    for (const proto of [null, 'http', 'ftp']) {
      const res = await viaProxy(phone.cookie, '203.0.113.50', proto)('GET', '/api/phone/push');
      expect(res.json(), String(proto)).toEqual({ publicKey: null });
    }
    expect(loadKeys).not.toHaveBeenCalled();
  });

  it('takes only the last X-Forwarded-Proto entry, which is the proxy\'s', async () => {
    const phone = await signIn('Player1');
    const res = await from(app, PROXY, phone.cookie, { 'x-forwarded-proto': 'https, http' })('GET', '/api/phone/push');
    expect(res.json()).toEqual({ publicKey: null });
    const ok = await from(app, PROXY, phone.cookie, { 'x-forwarded-proto': 'http, https' })('GET', '/api/phone/push');
    expect(ok.json()).toEqual({ publicKey: PUBLIC_KEY });
  });

  it('gives null when a caller other than the proxy claims HTTPS', async () => {
    const phone = await signIn('Player1');
    const res = await from(app, '203.0.113.60', phone.cookie, { 'x-forwarded-proto': 'https' })('GET', '/api/phone/push');
    expect(res.json()).toEqual({ publicKey: null });
  });

  it('gives null offline, even with a subject, a proxy, and an HTTPS header', async () => {
    await app.close();
    await start({ mode: 'offline' });
    const phone = await signIn('Player1');
    expect((await phone.api('GET', '/api/phone/push')).json()).toEqual({ publicKey: null });
    expect(loadKeys).not.toHaveBeenCalled();
  });

  it('gives null online without a subject', async () => {
    await app.close();
    await start({ push: { dataDir: '/data', loadKeys, send } });
    const phone = await signIn('Player1');
    expect((await phone.api('GET', '/api/phone/push')).json()).toEqual({ publicKey: null });
    expect(loadKeys).not.toHaveBeenCalled();
  });

  it('gives null, without failing, when the key file can not be read, and tries once', async () => {
    loadKeys.mockImplementationOnce(() => {
      throw new Error('not a key');
    });
    const phone = await signIn('Player1');
    for (let i = 0; i < 2; i++) expect((await phone.api('GET', '/api/phone/push')).json()).toEqual({ publicKey: null });
    expect(loadKeys).toHaveBeenCalledTimes(1);
    expect((await phone.api('PUT', '/api/phone/push', subscription(1))).statusCode).toBe(409);
  });

  it('is for a phone only', async () => {
    expect((await viaProxy()('GET', '/api/phone/push')).statusCode).toBe(401);
  });
});

describe('PUT /api/phone/push', () => {
  it('stores the subscription with 204, over HTTPS', async () => {
    const phone = await signIn('Player1');
    const body = subscription(1);
    const res = await phone.api('PUT', '/api/phone/push', body);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(rows('push_subscriptions')).toEqual([
      { phone_id: 1, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, created_at: expect.any(String) },
    ]);
  });

  it('replaces the phone\'s earlier subscription', async () => {
    const phone = await signIn('Player1');
    await phone.api('PUT', '/api/phone/push', subscription(1));
    await phone.api('PUT', '/api/phone/push', subscription(2));
    expect(rows('push_subscriptions')).toHaveLength(1);
    expect(rows('push_subscriptions')[0]).toMatchObject({ endpoint: `${FCM}2` });
  });

  it('gives an endpoint to the newest phone, so one browser signing in again is not alerted twice', async () => {
    const a = await signIn('Player1');
    const b = await signIn('Player1', otherIp(2));
    const body = subscription(1);
    await a.api('PUT', '/api/phone/push', body);
    expect((await b.api('PUT', '/api/phone/push', body)).statusCode).toBe(204);
    expect(rows('push_subscriptions')).toEqual([expect.objectContaining({ phone_id: 2 })]);
  });

  it('answers 409 push-off over plain HTTP, and before it looks at the body', async () => {
    const phone = await signIn('Player1');
    const plain = viaProxy(phone.cookie, '203.0.113.50', null);
    for (const body of [subscription(1), { endpoint: 'https://example.com/x', keys: { p256dh: 'x', auth: 'y' } }]) {
      const res = await plain('PUT', '/api/phone/push', body);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'push-off' });
    }
    expect(rows('push_subscriptions')).toEqual([]);
  });

  it('answers 409 push-off offline and without a subject', async () => {
    await app.close();
    await start({ mode: 'offline' });
    expect((await (await signIn('Player1')).api('PUT', '/api/phone/push', subscription(1))).json()).toEqual({ error: 'push-off' });
    await app.close();
    await start({ push: { dataDir: '/data', loadKeys, send } });
    expect((await (await signIn('Player1')).api('PUT', '/api/phone/push', subscription(1))).statusCode).toBe(409);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/1',
    'https://example.com/push',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evil.example/fcm.googleapis.com',
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://localhost/x',
    'https://fcm.googleapis.com:8443/x',
    'https://user:pw@fcm.googleapis.com/x',
    'not a url',
    '',
  ])('answers 400 bad-request for the endpoint "%s", and stores nothing', async (endpoint) => {
    const phone = await signIn('Player1');
    const res = await phone.api('PUT', '/api/phone/push', { ...subscription(1), endpoint });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect(rows('push_subscriptions')).toEqual([]);
  });

  const point = (first: number, length: number) => Buffer.concat([Buffer.from([first]), randomBytes(length - 1)]).toString('base64url');
  it.each([
    ['p256dh that is not base64url', { p256dh: 'not base64url!!', auth: randomBytes(16).toString('base64url') }],
    ['p256dh of 64 bytes', { p256dh: point(4, 64), auth: randomBytes(16).toString('base64url') }],
    ['p256dh of 66 bytes', { p256dh: point(4, 66), auth: randomBytes(16).toString('base64url') }],
    ['p256dh that does not start 0x04', { p256dh: point(2, 65), auth: randomBytes(16).toString('base64url') }],
    ['p256dh with padding', { p256dh: `${point(4, 65)}=`, auth: randomBytes(16).toString('base64url') }],
    ['auth of 15 bytes', { p256dh: point(4, 65), auth: randomBytes(15).toString('base64url') }],
    ['auth of 17 bytes', { p256dh: point(4, 65), auth: randomBytes(17).toString('base64url') }],
    ['an empty auth', { p256dh: point(4, 65), auth: '' }],
  ])('answers 400 bad-request for %s', async (_name, keys) => {
    const phone = await signIn('Player1');
    const res = await phone.api('PUT', '/api/phone/push', { endpoint: `${FCM}1`, keys });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect(rows('push_subscriptions')).toEqual([]);
  });

  it.each([
    ['no endpoint', { keys: subscription(1).keys }],
    ['no keys', { endpoint: `${FCM}1` }],
    ['a field the contract does not list', { ...subscription(1), expirationTime: null }],
    ['a field inside keys the contract does not list', { endpoint: `${FCM}1`, keys: { ...subscription(1).keys, extra: 'x' } }],
    ['an endpoint over 2048 characters', { ...subscription(1), endpoint: `${FCM}${'a'.repeat(2100)}` }],
  ])('answers 400 bad-request for a body with %s', async (_name, body) => {
    const phone = await signIn('Player1');
    const res = await phone.api('PUT', '/api/phone/push', body as object);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });
});

describe('DELETE /api/phone/push', () => {
  it('removes the subscription with 204, and answers 204 again when there is none, in any mode', async () => {
    const phone = await signIn('Player1');
    await phone.api('PUT', '/api/phone/push', subscription(1));
    expect((await phone.api('DELETE', '/api/phone/push')).statusCode).toBe(204);
    expect(rows('push_subscriptions')).toEqual([]);
    expect((await phone.api('DELETE', '/api/phone/push')).statusCode).toBe(204);
    // Over plain HTTP too: turning alerts off never needs HTTPS.
    expect((await viaProxy(phone.cookie, '203.0.113.50', null)('DELETE', '/api/phone/push')).statusCode).toBe(204);
  });

  it('removes only this phone\'s subscription', async () => {
    const a = await signIn('Player1');
    const b = await signIn('Player2', otherIp(2));
    await a.api('PUT', '/api/phone/push', subscription(1));
    await b.api('PUT', '/api/phone/push', subscription(2));
    await a.api('DELETE', '/api/phone/push');
    expect(rows('push_subscriptions')).toEqual([expect.objectContaining({ endpoint: `${FCM}2` })]);
  });
});

describe('a push on a call', () => {
  /** A phone following these handles, subscribed with endpoint number `n`. */
  async function subscribed(handles: string[], n: number, ip = '203.0.113.50') {
    const phone = await signIn(handles[0]!, ip);
    for (const handle of handles.slice(1)) await phone.api('POST', '/api/phone/follow', { handle, pin: PIN });
    await phone.api('PUT', '/api/phone/push', subscription(n));
    return phone;
  }
  const settle = () => app.pushIdle();
  const seen = () => sent.map((s) => `${s.payload.alert}:${s.payload.handle}`).sort();
  const four = () => ['Player1', 'Player2', 'Player3', 'Player4'];
  const bracket4 = async (): Promise<Bracket> =>
    (await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 4) })).json().bracket;

  it('sends called to the players on the station and next to the first match waiting, when the bracket starts', async () => {
    await subscribed(four(), 1);
    const made = await bracket4();
    await settle();
    const onStation = onStations(made)[0]!.slots.map((s) => s.player!.handle);
    const waiting = made.upNext[0]!.slots.map((s) => s.player!.handle);
    expect(seen()).toEqual([...onStation.map((h) => `called:${h}`), ...waiting.map((h) => `next:${h}`)].sort());
    for (const s of sent) {
      expect(s.sub.endpoint).toBe(`${FCM}1`);
      expect(Object.keys(s.payload).sort()).toEqual(['alert', 'handle', 'station']);
      expect(s.payload.station).toBe(s.payload.alert === 'called' ? 1 : null);
      expect(s.vapid).toMatchObject({ publicKey: PUBLIC_KEY, subject: SUBJECT, privateKey });
    }
    // What goes to the push service is the stored subscription, as the sender wants it.
    expect(Object.keys(sent[0]!.sub).sort()).toEqual(['auth', 'endpoint', 'p256dh']);
  });

  it('does not repeat: a reload, an event rename, a follow, or a read sends nothing more', async () => {
    const phone = await subscribed(four(), 1);
    await bracket4();
    await settle();
    const first = sent.length;
    expect(first).toBe(4);
    await host('PUT', '/api/event', { name: 'Friday' });
    await host('PATCH', `/api/players/${ids[0]}`, { handle: 'Zapper' });
    await host('GET', '/api/bracket');
    await phone.api('GET', '/api/phone');
    await phone.api('POST', '/api/phone/follow', { handle: 'Player5', pin: PIN });
    await settle();
    expect(sent).toHaveLength(first);
  });

  it('sends called once to the players of the next match when the match on the station is recorded', async () => {
    await subscribed(four(), 1);
    const made = await bracket4();
    await settle();
    sent.length = 0;
    const match = onStations(made)[0]!;
    const res = await host('POST', '/api/bracket/results', { matchId: match.id, winnerId: match.slots[0].player!.id });
    const after = res.json().bracket as Bracket;
    await settle();
    expect(seen()).toEqual(after.stations[0]!.match!.slots.map((s) => `called:${s.player!.handle}`).sort());
    expect(sent.every((s) => s.payload.station === 1)).toBe(true);
    // Reloading again is quiet.
    await host('PUT', '/api/event', { name: 'Later' });
    await settle();
    expect(sent).toHaveLength(2);
  });

  it('alerts again when a result is undone and the player is called back', async () => {
    await subscribed(four(), 1);
    const made = await bracket4();
    const match = onStations(made)[0]!;
    const recorded = await host('POST', '/api/bracket/results', { matchId: match.id, winnerId: match.slots[0].player!.id });
    await settle();
    sent.length = 0;
    await host('POST', '/api/bracket/undo', { resultId: recorded.json().resultId });
    await settle();
    // Back on the station: called again. The match that had been called is waiting again: next.
    const called = sent.filter((s) => s.payload.alert === 'called').map((s) => s.payload.handle);
    expect(called.sort()).toEqual(match.slots.map((s) => s.player!.handle).sort());
    expect(sent.filter((s) => s.payload.alert === 'next')).toHaveLength(2);
  });

  it('sends nothing for two away, for later, or for a player nobody with a subscription follows', async () => {
    const made8 = await (async () => {
      await subscribed(['Player1', 'Player2', 'Player3', 'Player4', 'Player5', 'Player6'], 1);
      return (await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids })).json().bracket as Bracket;
    })();
    await settle();
    const alerted = new Set(sent.map((s) => s.payload.handle));
    const handleOf = (m: Bracket['upNext'][number]) => m.slots.map((s) => s.player!.handle);
    for (const handle of [...handleOf(made8.upNext[1]!), ...handleOf(made8.upNext[2]!)]) expect(alerted.has(handle), handle).toBe(false);
    // Players 7 and 8 aren't followed by anyone.
    expect(alerted.has('Player7') || alerted.has('Player8')).toBe(false);
  });

  it('sends to every subscribed phone that follows the player, and to none that is not subscribed', async () => {
    await subscribed(['Player1'], 1);
    await subscribed(['Player1'], 2, otherIp(2));
    // Not subscribed, so it gets nothing.
    await signIn('Player1', otherIp(3));
    // Four players, one station: every player is on it or first in Up next, so Player1 is alerted.
    await bracket4();
    await settle();
    expect(sent.map((s) => s.sub.endpoint).sort()).toEqual([`${FCM}1`, `${FCM}2`]);
    expect(new Set(sent.map((s) => s.payload.handle))).toEqual(new Set(['Player1']));
  });

  it('stops after the phone turns alerts off or signs out', async () => {
    const off = await subscribed(four(), 1);
    const out = await subscribed(four(), 2, otherIp(2));
    await off.api('DELETE', '/api/phone/push');
    await out.api('POST', '/api/phone/sign-out');
    await bracket4();
    await settle();
    expect(sent).toEqual([]);
  });

  it('deletes a subscription the push service says is gone, and sends it nothing more', async () => {
    await subscribed(four(), 1);
    await subscribed(four(), 2, otherIp(2));
    outcome = (sub) => (sub.endpoint === `${FCM}1` ? 'gone' : 'sent');
    const made = await bracket4();
    await settle();
    expect(rows('push_subscriptions')).toEqual([expect.objectContaining({ endpoint: `${FCM}2` })]);
    sent.length = 0;
    const match = onStations(made)[0]!;
    await host('POST', '/api/bracket/results', { matchId: match.id, winnerId: match.slots[0].player!.id });
    await settle();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((s) => s.sub.endpoint === `${FCM}2`)).toBe(true);
  });

  it('keeps a subscription when the send failed, and when the sender threw', async () => {
    await subscribed(four(), 1);
    outcome = () => 'failed';
    const made = await bracket4();
    await settle();
    expect(rows('push_subscriptions')).toHaveLength(1);
    outcome = () => {
      throw new Error('boom');
    };
    const match = onStations(made)[0]!;
    const res = await host('POST', '/api/bracket/results', { matchId: match.id, winnerId: match.slots[0].player!.id });
    expect(res.statusCode).toBe(200);
    await settle();
    expect(rows('push_subscriptions')).toHaveLength(1);
  });

  it('does not make a write wait for the sending, or fail it', async () => {
    await subscribed(four(), 1);
    const releases: (() => void)[] = [];
    outcome = () => new Promise<PushOutcome>((resolve) => releases.push(() => resolve('sent')));
    const started = Date.now();
    const res = await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 4) });
    expect(res.statusCode).toBe(201);
    expect(Date.now() - started).toBeLessThan(1000);
    // The sender is still waiting on the push service; the next write goes through anyway.
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    const made = res.json().bracket as Bracket;
    const match = onStations(made)[0]!;
    const next = await host('POST', '/api/bracket/results', { matchId: match.id, winnerId: match.slots[0].player!.id });
    expect(next.statusCode).toBe(200);
    outcome = () => 'sent';
    releases.forEach((release) => release());
    await settle();
  });

  it('sends for heats too, with the station', async () => {
    await subscribed(['Player1', 'Player2', 'Player3', 'Player4', 'Player5'], 1);
    const more = addPinPlayers(db, 5, 9);
    const made = (await host('POST', '/api/heats', heatsBody([...ids.slice(0, 5), ...more], { stations: 1 }))).json().heats as Heats;
    await settle();
    const called = made.stations[0]!.heat!.players.map((p) => p.handle).filter((h) => ['Player1', 'Player2', 'Player3', 'Player4', 'Player5'].includes(h));
    expect(sent.filter((s) => s.payload.alert === 'called').map((s) => s.payload.handle).sort()).toEqual(called.sort());
    expect(sent.filter((s) => s.payload.alert === 'called').every((s) => s.payload.station === 1)).toBe(true);
    const total = sent.length;
    await host('PUT', '/api/event', { name: 'Friday' });
    await settle();
    expect(sent).toHaveLength(total);
  });

  it('starts alerts again for a new bracket, as everyone was out of the old one', async () => {
    await subscribed(four(), 1);
    await bracket4();
    await host('DELETE', '/api/bracket');
    await settle();
    sent.length = 0;
    await bracket4();
    await settle();
    expect(sent.length).toBe(4);
  });

  it('sends nothing offline, where no push is set up', async () => {
    await app.close();
    await start({ mode: 'offline' });
    const laptop = from(app, '127.0.0.1');
    await signIn('Player1');
    await laptop('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 4) });
    await app.pushIdle();
    expect(sent).toEqual([]);
  });
});

describe('after a restart', () => {
  let dir: string;
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('does not alert for what was already called, and alerts for the next change', async () => {
    dir = await mkdtemp(join(tmpdir(), 'coliseumgrid-push-'));
    const file = join(dir, 'test.db');
    await app.close();
    // The first run: offline, a bracket under way, a phone following the players, a subscription stored.
    const first = openDatabase(file);
    app = await buildApp({ db: first });
    await app.ready();
    const callers = await makeCallers(app);
    const playerIds = addPinPlayers(first, 4);
    const made = (await callers.host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds })).json().bracket as Bracket;
    const phoneRes = await from(app, otherIp(5))('POST', '/api/phone/follow', { handle: 'Player1', pin: PIN });
    expect(phoneRes.statusCode).toBe(201);
    const phoneCookie = (phoneRes.headers['set-cookie'] as string).split(';')[0]!;
    for (const handle of ['Player2', 'Player3', 'Player4']) {
      await from(app, otherIp(5), phoneCookie)('POST', '/api/phone/follow', { handle, pin: PIN });
    }
    await app.close();

    // The second run: online with push. Starting it sends nothing.
    sent = [];
    db = openDatabase(file);
    app = await buildApp({ db, mode: 'online', hostPassword: HOST_PASSWORD, trustedProxy: PROXY, push: { subject: SUBJECT, dataDir: '/data', loadKeys, send } });
    await app.ready();
    db.prepare("INSERT INTO push_subscriptions (phone_id, endpoint, p256dh, auth, created_at) VALUES (1, ?, 'p', 'a', 't')").run(`${FCM}1`);
    host = from(app, REMOTE, await signInHost(app, REMOTE));
    await host('PUT', '/api/event', { name: 'Friday' });
    await app.pushIdle();
    expect(sent).toEqual([]);

    // Recording the result calls the next match, and the phone following its players is alerted.
    const match = onStations(made)[0]!;
    const res = await host('POST', '/api/bracket/results', { matchId: match.id, winnerId: match.slots[0].player!.id });
    await app.pushIdle();
    const nowOnStation = (res.json().bracket as Bracket).stations[0]!.match!.slots.map((s) => s.player!.handle);
    expect(sent.map((s) => `${s.payload.alert}:${s.payload.handle}`).sort()).toEqual(nowOnStation.map((h) => `called:${h}`).sort());
  });
});
