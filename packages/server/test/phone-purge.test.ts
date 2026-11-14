// Deleting phones nobody has used for 90 days (docs/PLAN.md, "Player view", "Storage"), and
// last_seen being refreshed by use, which the purge depends on.

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { iso } from '../src/clock.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { PHONE_PURGE_EVERY_MS, startPhonePurge } from '../src/phone-purge.ts';
import { PHONE_IDLE_MAX_MS, PHONE_SEEN_THROTTLE_MS, createPhones } from '../src/phones.ts';
import { cookieFrom } from './helpers.ts';
import { PIN, addPinPlayers, from } from './phone-helpers.ts';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2027-07-10T12:00:00Z');

let db: Database;
let clock = START;
const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const lastSeen = (id: number): string => (db.prepare('SELECT last_seen FROM phones WHERE id = ?').get(id) as { last_seen: string }).last_seen;

/** Makes a phone following `playerId` with a subscription, last seen `idleMs` ago. */
function phoneIdle(phones: ReturnType<typeof createPhones>, token: string, playerId: number, idleMs: number): number {
  const id = phones.create(token, playerId);
  db.prepare('UPDATE phones SET last_seen = ? WHERE id = ?').run(iso(clock - idleMs), id);
  db.prepare("INSERT INTO push_subscriptions (phone_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, 'p', 'a', 't')").run(id, `https://fcm.googleapis.com/x/${token}`);
  return id;
}

beforeEach(() => {
  clock = START;
  db = openDatabase(':memory:');
});
// The app closes the database it was given.
afterEach(() => {
  if (db.isOpen) db.close();
});

describe('Phones.purgeIdle', () => {
  it('deletes phones idle for more than 90 days with their follows and subscriptions, and keeps the rest', () => {
    const [player] = addPinPlayers(db, 1);
    const phones = createPhones(db, () => clock);
    const old = phoneIdle(phones, 'old', player!, PHONE_IDLE_MAX_MS + 1);
    const edge = phoneIdle(phones, 'edge', player!, PHONE_IDLE_MAX_MS);
    const fresh = phoneIdle(phones, 'fresh', player!, 89 * DAY);
    expect(phones.purgeIdle(PHONE_IDLE_MAX_MS)).toEqual([old]);
    expect(db.prepare('SELECT id FROM phones ORDER BY id').all()).toEqual([{ id: edge }, { id: fresh }]);
    expect(count('phone_follows')).toBe(2);
    expect(count('push_subscriptions')).toBe(2);
    // The player is not touched.
    expect(count('players')).toBe(1);
  });

  it('returns nothing and deletes nothing when every phone is in use', () => {
    const [player] = addPinPlayers(db, 1);
    const phones = createPhones(db, () => clock);
    phoneIdle(phones, 'a', player!, 0);
    expect(phones.purgeIdle(PHONE_IDLE_MAX_MS)).toEqual([]);
    expect(count('phones')).toBe(1);
  });
});

describe('startPhonePurge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('purges at startup, then once a day, and stops when told to', () => {
    const [player] = addPinPlayers(db, 1);
    const phones = createPhones(db, () => clock);
    phoneIdle(phones, 'old', player!, 100 * DAY);
    const purged: number[][] = [];
    const stop = startPhonePurge(phones, (ids) => purged.push(ids), () => undefined);
    expect(purged).toHaveLength(1);
    expect(count('phones')).toBe(0);

    // A phone that goes idle later is found by the next day's run, and not before.
    clock += 1000 * DAY;
    phoneIdle(phones, 'later', player!, 100 * DAY);
    vi.advanceTimersByTime(PHONE_PURGE_EVERY_MS - 1);
    expect(count('phones')).toBe(1);
    vi.advanceTimersByTime(1);
    expect(count('phones')).toBe(0);
    expect(purged).toHaveLength(2);

    stop();
    phoneIdle(phones, 'after stop', player!, 100 * DAY);
    vi.advanceTimersByTime(3 * PHONE_PURGE_EVERY_MS);
    expect(count('phones')).toBe(1);
  });

  it('warns and tries again the next day when a purge throws', () => {
    const phones = { purgeIdle: vi.fn(() => { throw new Error('disk full'); }) } as unknown as ReturnType<typeof createPhones>;
    const warnings: string[] = [];
    const stop = startPhonePurge(phones, () => undefined, (message) => warnings.push(message));
    vi.advanceTimersByTime(PHONE_PURGE_EVERY_MS);
    expect(warnings).toEqual(['Idle phones could not be purged: disk full', 'Idle phones could not be purged: disk full']);
    stop();
  });
});

describe('in the app', () => {
  let app: FastifyInstance;
  afterEach(() => app.close());

  it('purges at startup', async () => {
    const [player] = addPinPlayers(db, 1);
    // A phone from before: 100 days idle when the server starts.
    const phones = createPhones(db, () => clock);
    phoneIdle(phones, 'stale', player!, 100 * DAY);
    app = await buildApp({ db, now: () => clock });
    await app.ready();
    expect(count('phones')).toBe(0);
    expect(count('push_subscriptions')).toBe(0);
    // Players stay.
    expect(count('players')).toBe(1);
  });

  it('keeps last_seen current: a phone in use is refreshed at most once a minute', async () => {
    app = await buildApp({ db, now: () => clock });
    await app.ready();
    addPinPlayers(db, 1);
    const res = await from(app, '198.51.100.20')('POST', '/api/phone/follow', { handle: 'Player1', pin: PIN });
    const cookie = cookieFrom(res);
    const phone = from(app, '198.51.100.20', cookie);
    expect(lastSeen(1)).toBe(iso(START));
    clock += PHONE_SEEN_THROTTLE_MS - 1;
    await phone('GET', '/api/phone');
    expect(lastSeen(1)).toBe(iso(START));
    clock += 1;
    await phone('GET', '/api/phone');
    expect(lastSeen(1)).toBe(iso(clock));
    // A phone that keeps using the page is never old enough to purge, however long ago it signed in.
    clock += 89 * DAY;
    await phone('GET', '/api/phone');
    expect(lastSeen(1)).toBe(iso(clock));
  });
});
