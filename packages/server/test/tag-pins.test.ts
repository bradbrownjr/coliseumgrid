// The plain PINs in the print queue (docs/PLAN.md, "The print queue"): a PIN stored 12 hours ago
// is wiped at startup and hourly while its tag stays queued, and a PIN that leaves the queue is
// gone from the database file itself, not only from the answers.

import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { iso } from '../src/clock.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { TAG_PIN_WIPE_EVERY_MS, startTagPinWipe } from '../src/tag-pin-wipe.ts';
import { TAG_PIN_MAX_MS, createTagQueue } from '../src/tag-queue.ts';
import { addPlayers } from './bracket-api-helpers.ts';
import { from } from './phone-helpers.ts';

const HOUR = 60 * 60 * 1000;
// An unusual time, so its text is easy to find in the file.
const START = Date.parse('2027-07-10T12:34:56.789Z');

let clock = START;
let db: Database;
beforeEach(() => {
  clock = START;
});

const rows = () => db.prepare('SELECT player_id, pin, pin_stored_at FROM tag_queue ORDER BY player_id').all();

describe('TagQueue.wipeOldPins', () => {
  beforeEach(() => {
    db = openDatabase(':memory:');
  });
  afterEach(() => db.close());

  it('wipes a PIN stored 12 hours ago or more, keeps the tag, and leaves younger PINs and reprints alone', () => {
    const [old, young, reprint] = addPlayers(db, 3);
    const tags = createTagQueue(db, () => clock);
    tags.queue(old!, '1111');
    clock += HOUR;
    tags.queue(young!, '2222');
    tags.queue(reprint!, null);
    clock = START + TAG_PIN_MAX_MS - 1;
    expect(tags.wipeOldPins(TAG_PIN_MAX_MS)).toBe(0);
    clock += 1;
    expect(tags.wipeOldPins(TAG_PIN_MAX_MS)).toBe(1);
    expect(rows()).toEqual([
      { player_id: old, pin: null, pin_stored_at: null },
      { player_id: young, pin: '2222', pin_stored_at: iso(START + HOUR) },
      { player_id: reprint, pin: null, pin_stored_at: null },
    ]);
    expect(tags.list().map((t) => t.pin)).toEqual([null, '2222', null]);
  });

  it('counts the 12 hours from the newest PIN, not from a reprint after it', () => {
    const [id] = addPlayers(db, 1);
    const tags = createTagQueue(db, () => clock);
    tags.queue(id!, '1111');
    clock += 11 * HOUR;
    tags.queue(id!, null);
    clock += HOUR;
    expect(tags.wipeOldPins(TAG_PIN_MAX_MS)).toBe(1);
    // A new PIN starts its own 12 hours.
    tags.queue(id!, '3333');
    clock += 11 * HOUR;
    expect(tags.wipeOldPins(TAG_PIN_MAX_MS)).toBe(0);
    expect(tags.get(id!)?.pin).toBe('3333');
  });
});

describe('startTagPinWipe', () => {
  beforeEach(() => {
    db = openDatabase(':memory:');
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  it('wipes at startup, then every hour, tells the host screens only when it wiped one, and stops when told to', () => {
    const [a, b, c] = addPlayers(db, 3);
    const tags = createTagQueue(db, () => clock);
    tags.queue(a!, '1111');
    clock += TAG_PIN_MAX_MS;
    let told = 0;
    const stop = startTagPinWipe(tags, () => void told++, () => undefined);
    expect(told).toBe(1);
    expect(tags.get(a!)?.pin).toBeNull();

    tags.queue(b!, '2222');
    clock += TAG_PIN_MAX_MS;
    vi.advanceTimersByTime(TAG_PIN_WIPE_EVERY_MS - 1);
    expect(tags.get(b!)?.pin).toBe('2222');
    vi.advanceTimersByTime(1);
    expect(tags.get(b!)?.pin).toBeNull();
    expect(told).toBe(2);
    // An hour with nothing to wipe tells nobody.
    vi.advanceTimersByTime(TAG_PIN_WIPE_EVERY_MS);
    expect(told).toBe(2);

    stop();
    tags.queue(c!, '3333');
    clock += TAG_PIN_MAX_MS;
    vi.advanceTimersByTime(3 * TAG_PIN_WIPE_EVERY_MS);
    expect(tags.get(c!)?.pin).toBe('3333');
  });

  it('warns and tries again the next hour when a wipe throws', () => {
    const tags = { wipeOldPins: vi.fn(() => { throw new Error('disk full'); }) };
    const warnings: string[] = [];
    const stop = startTagPinWipe(tags, () => undefined, (message) => warnings.push(message));
    vi.advanceTimersByTime(TAG_PIN_WIPE_EVERY_MS);
    expect(warnings).toEqual([
      'Old PINs in the print queue could not be wiped: disk full',
      'Old PINs in the print queue could not be wiped: disk full',
    ]);
    stop();
  });
});

describe('in the app, with the database in a file', () => {
  let dir: string;
  let file: string;
  let app: FastifyInstance | undefined;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'coliseumgrid-tags-'));
    file = join(dir, 'coliseumgrid.db');
    db = openDatabase(file);
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (db.isOpen) db.close();
    await rm(dir, { recursive: true, force: true });
  });

  const start = async (): Promise<void> => {
    app = await buildApp({ db, dataDir: dir, now: () => clock });
    await app.ready();
  };
  const laptop = () => from(app as FastifyInstance, '127.0.0.1');

  /** The database file and its WAL, as they are on disk. */
  const onDisk = (): Buffer => Buffer.concat([readFileSync(file), existsSync(`${file}-wal`) ? readFileSync(`${file}-wal`) : Buffer.alloc(0)]);
  // A 4-digit string alone could turn up anywhere in the file (a time, a hash), so the search is
  // for the queue row's own bytes: SQLite stores a row's values one after another, and the PIN
  // column is followed by `pin_stored_at`, the time it was stored. Each test first finds the
  // pattern while the PIN is queued, so its absence afterwards means the bytes left the file.
  const storedPin = (pin: string, at: number): Buffer => Buffer.from(`${pin}${iso(at)}`);

  it('deletes a printed tag\'s PIN from the database file and its WAL', async () => {
    await start();
    const res = await laptop()('POST', '/api/signup', { handle: 'Zap', pin: '4821' });
    expect(res.statusCode).toBe(201);
    const id = res.json().player.id as number;
    expect(onDisk().includes(storedPin('4821', START)), 'the queued PIN is in the file before Yes').toBe(true);

    expect((await laptop()('POST', '/api/tags/printed', { playerIds: [id] })).statusCode).toBe(204);
    expect(rows()).toEqual([]);
    expect(onDisk().includes(storedPin('4821', START))).toBe(false);
  });

  it('wipes a PIN stored 12 hours ago at startup, from the file too, and keeps its tag queued', async () => {
    const [id] = addPlayers(db, 1);
    createTagQueue(db, () => clock).queue(id!, '4821');
    // Written to the main file, as a server that ran for a while would have.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    expect(onDisk().includes(storedPin('4821', START))).toBe(true);

    clock += TAG_PIN_MAX_MS;
    await start();
    expect(rows()).toEqual([{ player_id: id, pin: null, pin_stored_at: null }]);
    expect((await laptop()('GET', '/api/tags')).json()).toEqual({ tags: [{ playerId: id, handle: 'Player1', pin: null }] });
    expect(onDisk().includes(storedPin('4821', START))).toBe(false);
  });

  it('keeps a PIN stored less than 12 hours ago at startup', async () => {
    const [id] = addPlayers(db, 1);
    createTagQueue(db, () => clock).queue(id!, '4821');
    clock += TAG_PIN_MAX_MS - 1;
    await start();
    expect(rows()).toEqual([{ player_id: id, pin: '4821', pin_stored_at: iso(START) }]);
  });

  it('deletes the queue\'s PINs from the file when a new event empties it', async () => {
    await start();
    await laptop()('POST', '/api/signup', { handle: 'Zap', pin: '4821' });
    expect(onDisk().includes(storedPin('4821', START))).toBe(true);
    expect((await laptop()('POST', '/api/events', { name: 'Saturday' })).statusCode).toBe(201);
    expect(onDisk().includes(storedPin('4821', START))).toBe(false);
  });
});
