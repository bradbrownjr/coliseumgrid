// The bracket tables: a state saved is the state loaded, whatever the engine made it.

import { createSeededRandom } from '@coliseumgrid/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { bracketAnswer, joinLate, startTieBreak, undoResult, type BracketState } from '../src/bracket-engine.ts';
import { createBracketStore, type BracketStore } from '../src/bracket-store.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { addPlayers } from './bracket-api-helpers.ts';
import { at, expectOk, handles, ids as playerIds, onStations, play, playOutInBatches, randomPick, start } from './bracket-helpers.ts';

let db: Database;
let store: BracketStore;
let eventId: number;

beforeEach(() => {
  db = openDatabase(':memory:');
  store = createBracketStore(db);
  eventId = Number(db.prepare("INSERT INTO events (name, created_at) VALUES ('Friday', 't')").run().lastInsertRowid);
});

const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('the bracket store', () => {
  it('has nothing for an event with no bracket', () => {
    expect(store.load(eventId)).toBeNull();
    expect(store.remove(eventId)).toBe(false);
  });

  it('loads exactly the state it saved, for each format, after play, a late join, and tie-breaks', async () => {
    const random = createSeededRandom(7);
    for (const [format, n] of [['single', 6], ['double', 5], ['round_robin', 5]] as const) {
      store.remove(eventId);
      const run = await start(format, n, 3, 2);
      // A late player joins before play; it changes the seeding and adds a late-join row.
      const joined = expectOk(await joinLate(run.state, n + 1, handles));
      const played = await playOutInBatches(joined, random, randomPick(random));
      store.save(eventId, played.state);
      expect(store.load(eventId), format).toEqual(played.state);
    }
  });

  it('stores tie-break matches and their results in order', async () => {
    // Five players, each beating the one after it and losing to the one before, with 1 beating
    // 5 as well, is a five-way tie on wins (2 each), which needs tie-break matches.
    let run = await start('round_robin', 5, 11, 1);
    const cycle = (a: number, b: number): number => ((b - a + 5) % 5 <= 2 && a !== b ? a : b);
    for (let guard = 0; guard < 200; guard++) {
      const live = onStations(run.bracket)[0];
      if (!live) break;
      const [x, y] = live.slots.map((s) => s.player?.id as number) as [number, number];
      run = await play(run, live, cycle(x, y) === x ? 0 : 1);
    }
    expect(run.bracket.ties.length).toBeGreaterThan(0);
    run = expectOk(await startTieBreak(run.state, handles));
    expect(run.state.tieBreaks.length).toBeGreaterThan(0);
    const live = onStations(run.bracket)[0];
    expect(live).toBeDefined();
    run = await play(run, live as NonNullable<typeof live>, 0);
    store.save(eventId, run.state);
    expect(store.load(eventId)).toEqual(run.state);
    expect(count('bracket_tie_breaks')).toBe(run.state.tieBreaks.length);
    expect(count('bracket_results')).toBe(run.state.results.length);
  });

  it('rewrites the rows when a result is undone, so the database equals the state', async () => {
    let run = await start('double', 6, 3, 2);
    for (let i = 0; i < 4; i++) run = await play(run, onStations(run.bracket)[0] as never, 0);
    store.save(eventId, run.state);
    const older = run.state.results[1]?.id as number;
    const undone = expectOk(await undoResult(run.state, run.state.results.at(-1)?.id as number, handles));
    store.save(eventId, undone.state);
    expect(count('bracket_results')).toBe(3);
    expect(store.load(eventId)).toEqual(undone.state);
    expect(store.load(eventId)?.results.map((r) => r.id)).toContain(older);
  });

  it('keeps the answer the same after a save and load', async () => {
    const random = createSeededRandom(3);
    const run = await playOutInBatches(await start('single', 7, 5, 3), random, randomPick(random));
    store.save(eventId, run.state);
    expect(await bracketAnswer(store.load(eventId) as BracketState, handles)).toEqual(run.bracket);
  });

  it('replaces the event\'s bracket when another is saved, and removes the old rows with it', async () => {
    const first = await start('single', 4, 1, 2);
    const played = await play(first, onStations(first.bracket)[0] as never, 0);
    store.save(eventId, played.state);
    expect(count('bracket_results')).toBe(1);
    const second = { ...(await start('round_robin', 3, 2, 1)).state, settings: { ...first.state.settings, id: store.nextBracketId(), format: 'round_robin' as const } };
    store.save(eventId, { ...second, seeding: [playerIds(3)[0] as number, 2, 3, null] });
    expect(count('brackets')).toBe(1);
    expect(count('bracket_results')).toBe(0);
    expect(store.load(eventId)?.settings.id).toBe(second.settings.id);
  });

  it('gives each bracket and result an id that is never used again', async () => {
    expect(store.nextBracketId()).toBe(1);
    expect(store.nextResultId()).toBe(1);
    const run = await start('single', 4, 1, 2);
    const played = await play(run, onStations(run.bracket)[0] as never, 0);
    store.save(eventId, played.state);
    expect(store.nextBracketId()).toBe(2);
    expect(store.nextResultId()).toBe((played.state.results[0]?.id ?? 0) + 1);
    const next = store.nextResultId();
    // Undoing the newest result, or deleting the bracket, doesn't free an id.
    store.save(eventId, { ...played.state, results: [] });
    expect(store.nextResultId()).toBe(next);
    store.remove(eventId);
    expect(store.nextBracketId()).toBe(2);
    expect(store.nextResultId()).toBe(next);
  });

  it('leaves the stored bracket alone when a save fails part-way', async () => {
    const run = await start('single', 4, 1, 2);
    store.save(eventId, run.state);
    const played = await play(run, onStations(run.bracket)[0] as never, 0);
    const broken: BracketState = { ...played.state, results: played.state.results.map((r) => ({ ...r, at: null as never })) };
    expect(() => store.save(eventId, broken)).toThrow();
    expect(store.load(eventId)).toEqual(run.state);
    expect(count('bracket_results')).toBe(0);
  });

  it('says whether a player is in the event\'s bracket, late joins and finished brackets included', async () => {
    addPlayers(db, 12);
    const run = await start('single', 3, 1, 2);
    const joined = expectOk(await joinLate(run.state, 4, handles));
    store.save(eventId, joined.state);
    for (const id of [1, 2, 3, 4]) expect(store.hasPlayer(eventId, id), `player ${id}`).toBe(true);
    expect(store.hasPlayer(eventId, 5)).toBe(false);
    const other = Number(db.prepare("INSERT INTO events (name, created_at) VALUES ('Next', 't')").run().lastInsertRowid);
    expect(store.hasPlayer(other, 1)).toBe(false);
    store.remove(eventId);
    expect(store.hasPlayer(eventId, 1)).toBe(false);
  });

  it('refuses a second bracket for the same event unless it replaces the first', () => {
    store.save(eventId, {
      settings: { id: 1, format: 'single', bestOf: 1, stations: 1, createdAt: at(0) },
      seeding: [1, 2],
      lateJoins: [],
      results: [],
      tieBreaks: [],
    });
    expect(() =>
      db
        .prepare("INSERT INTO brackets (event_id, format, best_of, stations, seeding, created_at) VALUES (?, 'single', 1, 1, '[]', 't')")
        .run(eventId),
    ).toThrow(/UNIQUE/);
  });
});
