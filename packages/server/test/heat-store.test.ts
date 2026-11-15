// The heat tables: a state saved is the state loaded, whatever the engine made it.

import { createSeededRandom } from '@coliseumgrid/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../src/database.ts';
import { heatsAnswer, joinHeatsLate, setHeatArrived, startHeatTieBreak, type HeatState } from '../src/heat-engine.ts';
import { createHeatStore, type HeatStore } from '../src/heat-store.ts';
import { at, expectOk, handles, listedPick, onStations, play, playOut, randomPick, start, undo, type HeatRun } from './heat-helpers.ts';

let db: Database;
let store: HeatStore;
let eventId: number;

beforeEach(() => {
  db = openDatabase(':memory:');
  store = createHeatStore(db);
  eventId = Number(db.prepare("INSERT INTO events (name, created_at) VALUES ('Friday', 't')").run().lastInsertRowid);
});

const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

/** Plays every heat on a station, listed order, until a tie waits (the same tie for any seed). */
function playToTie(run: HeatRun): HeatRun {
  let now = run;
  for (let guard = 0; guard < 100; guard++) {
    const heat = onStations(now.heats)[0];
    if (!heat) return now;
    now = play(now, heat, listedPick(heat));
  }
  throw new Error('never stopped');
}

describe('the heat store', () => {
  it('has nothing for an event with no heats', () => {
    expect(store.load(eventId)).toBeNull();
    expect(store.remove(eventId)).toBe(false);
  });

  it('loads exactly the state it saved, for each size, after a late join, play, and a finished event', () => {
    const random = createSeededRandom(7);
    for (const [n, rounds] of [[2, 1], [3, 1], [5, 1], [8, 2], [10, 3], [13, 2], [32, 2]] as const) {
      store.remove(eventId);
      const run = start(n, n, { stations: 3, rounds });
      // A late player (when one fits) joins before play, and fills a late-join row.
      const joined = n >= 6 && n < 32 ? joinHeatsLate(run.state, 40, handles) : null;
      const base = joined?.ok ? { state: joined.state, heats: joined.heats } : run;
      const played = playOut(base, random, randomPick(random));
      store.save(eventId, played.state);
      expect(store.load(eventId), `${n} players`).toEqual(played.state);
      expect(heatsAnswer(store.load(eventId) as HeatState, handles), `${n} players`).toEqual(played.heats);
    }
  });

  it('stores late joins and tie-break heats, in order, with the step each was made at', () => {
    let run = start(10, 3, { stations: 2, rounds: 2 });
    run = expectOk(joinHeatsLate(run.state, 40, handles));
    expect(run.state.lateJoins).toHaveLength(1);
    run = playToTie(run);
    expect(run.heats.ties).toHaveLength(1);
    run = expectOk(startHeatTieBreak(run.state, handles));
    expect(run.state.tieBreaks.length).toBeGreaterThan(0);
    const heat = onStations(run.heats)[0];
    run = play(run, heat as NonNullable<typeof heat>, listedPick(heat as NonNullable<typeof heat>));
    store.save(eventId, run.state);
    expect(store.load(eventId)).toEqual(run.state);
    expect(count('heat_tie_breaks')).toBe(run.state.tieBreaks.length);
    expect(count('heat_late_joins')).toBe(1);
    expect(count('heat_results')).toBe(run.state.results.length);
    expect(db.prepare('SELECT players, step FROM heat_tie_breaks ORDER BY position').all()).toEqual(
      run.state.tieBreaks.map((t) => ({ players: JSON.stringify(t.players), step: t.step })),
    );
  });

  it('stores a tie-break\'s time and the arrivals, and a tie-break without a time loads without one', () => {
    const run = playToTie(start(10, 3, { stations: 2, rounds: 2 }));
    const old = expectOk(startHeatTieBreak(run.state, handles));
    store.save(eventId, old.state);
    expect(store.load(eventId)?.tieBreaks.every((t) => !('at' in t))).toBe(true);
    expect(db.prepare('SELECT at FROM heat_tie_breaks').all().every((r) => r['at'] === null)).toBe(true);

    const made = expectOk(startHeatTieBreak(run.state, handles, 5, at(30)));
    const here = expectOk(setHeatArrived(made.state, { heatId: onStations(made.heats)[0]?.id as number, arrived: true }, handles));
    store.save(eventId, here.state);
    expect(store.load(eventId)).toEqual(here.state);
    expect(store.load(eventId)?.tieBreaks.every((t) => t.at === at(30))).toBe(true);
    expect(count('heat_arrivals')).toBe(1);
    store.save(eventId, made.state);
    expect(count('heat_arrivals')).toBe(0);
    store.save(eventId, here.state);
    store.remove(eventId);
    expect(count('heat_arrivals')).toBe(0);
  });

  it('rewrites the rows when the newest result is undone, so the database equals the state', () => {
    let run = start(10, 4, { stations: 3, rounds: 2 });
    for (let i = 0; i < 3; i++) run = play(run, onStations(run.heats)[0] as never, listedPick(onStations(run.heats)[0] as never));
    store.save(eventId, run.state);
    const older = run.state.results[1]?.id as number;
    const undone = expectOk(undo(run.state, run.state.results.at(-1)?.id as number));
    store.save(eventId, undone.state);
    expect(count('heat_results')).toBe(2);
    expect(store.load(eventId)).toEqual(undone.state);
    expect(store.load(eventId)?.results.map((r) => r.id)).toContain(older);
  });

  it('keeps an older undo: the result stays, with the step and time of the undo', () => {
    let run = start(10, 5, { stations: 2, rounds: 2 });
    for (let i = 0; i < 2; i++) run = play(run, onStations(run.heats)[0] as never, listedPick(onStations(run.heats)[0] as never));
    const older = run.state.results[0]?.id as number;
    const undone = expectOk(undo(run.state, older));
    store.save(eventId, undone.state);
    expect(count('heat_results')).toBe(2);
    expect(store.load(eventId)).toEqual(undone.state);
    expect(store.load(eventId)?.results[0]?.undone).toEqual({ step: 2, at: at(3) });
    expect(store.load(eventId)?.results[1]).not.toHaveProperty('undone');
    expect(heatsAnswer(store.load(eventId) as HeatState, handles)).toEqual(undone.heats);
  });

  it('replaces the event\'s heats when others are saved, and removes the old rows with them', () => {
    const first = start(10, 1, { stations: 2, rounds: 2 });
    const played = play(first, onStations(first.heats)[0] as never, listedPick(onStations(first.heats)[0] as never));
    store.save(eventId, played.state);
    expect(count('heat_results')).toBe(1);
    const second = start(5, 2, { stations: 1, rounds: 1 });
    store.save(eventId, { ...second.state, settings: { ...second.state.settings, id: store.nextRunId() } });
    expect(count('heat_runs')).toBe(1);
    expect(count('heat_results')).toBe(0);
    expect(store.load(eventId)?.settings.id).toBe(2);
  });

  it('gives each run and result an id that is never used again', () => {
    expect(store.nextRunId()).toBe(1);
    expect(store.nextResultId()).toBe(1);
    const run = start(10, 1, { stations: 2, rounds: 2 });
    const played = play(run, onStations(run.heats)[0] as never, listedPick(onStations(run.heats)[0] as never));
    store.save(eventId, played.state);
    expect(store.nextRunId()).toBe(2);
    expect(store.nextResultId()).toBe((played.state.results[0]?.id ?? 0) + 1);
    const next = store.nextResultId();
    // Undoing the newest result, or deleting the heats, doesn't free an id.
    store.save(eventId, { ...played.state, results: [] });
    expect(store.nextResultId()).toBe(next);
    store.remove(eventId);
    expect(store.nextRunId()).toBe(2);
    expect(store.nextResultId()).toBe(next);
  });

  it('leaves the stored heats alone when a save fails part-way', () => {
    const run = start(10, 1, { stations: 2, rounds: 2 });
    store.save(eventId, run.state);
    const played = play(run, onStations(run.heats)[0] as never, listedPick(onStations(run.heats)[0] as never));
    const broken: HeatState = { ...played.state, results: played.state.results.map((r) => ({ ...r, at: null as never })) };
    expect(() => store.save(eventId, broken)).toThrow();
    expect(store.load(eventId)).toEqual(run.state);
    expect(count('heat_results')).toBe(0);
  });

  it('leaves the old heats in place when a replacement fails part-way', () => {
    const run = start(10, 1, { stations: 2, rounds: 2 });
    store.save(eventId, run.state);
    const other = start(5, 2, { stations: 1, rounds: 1 });
    const broken: HeatState = { ...other.state, settings: { ...other.state.settings, id: 2, createdAt: null as never } };
    expect(() => store.save(eventId, broken)).toThrow();
    expect(store.load(eventId)).toEqual(run.state);
  });

  it('says whether a player is in the event\'s heats, late joins and finished heats included', () => {
    const run = start(10, 6, { stations: 2, rounds: 2 });
    const joined = expectOk(joinHeatsLate(run.state, 40, handles));
    store.save(eventId, joined.state);
    for (const id of [...run.state.seeding, 40]) expect(store.hasPlayer(eventId, id), `player ${id}`).toBe(true);
    expect(store.hasPlayer(eventId, 39)).toBe(false);
    expect(store.hasPlayer(eventId, 11)).toBe(false);
    const other = Number(db.prepare("INSERT INTO events (name, created_at) VALUES ('Next', 't')").run().lastInsertRowid);
    expect(store.hasPlayer(other, 1)).toBe(false);
    store.remove(eventId);
    expect(store.hasPlayer(eventId, 1)).toBe(false);
  });

  it('refuses a second run for the same event unless it replaces the first', () => {
    store.save(eventId, start(5, 1, { stations: 1, rounds: 1 }).state);
    expect(() =>
      db
        .prepare("INSERT INTO heat_runs (event_id, stations, races, rounds, points, seeding, created_at) VALUES (?, 1, 1, 1, '[4,3,2,1]', '[]', 't')")
        .run(eventId),
    ).toThrow(/UNIQUE/);
  });

  it('stores no handle, only ids, settings, and times', () => {
    const random = createSeededRandom(2);
    const run = playOut(start(8, 2, { stations: 2, rounds: 2 }), random, randomPick(random));
    store.save(eventId, run.state);
    const everything = JSON.stringify(['heat_runs', 'heat_results', 'heat_late_joins', 'heat_tie_breaks'].map((t) => db.prepare(`SELECT * FROM ${t}`).all()));
    expect(everything).not.toMatch(/Player\d/);
  });
});
