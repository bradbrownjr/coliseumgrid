// The heat tables (docs/PLAN.md, "Heats API"). The engine's `HeatState` goes in and comes out
// whole: a save rewrites the run's rows in one transaction, so the database equals the state
// exactly and a failed save leaves the old run untouched (CLAUDE.md, rule 5). Only ids,
// settings, and times are stored; a handle is read from `players` when an answer is made
// (CLAUDE.md, rule 1).

import type { RacesPerHeat } from '@coliseumgrid/core';
import { inTransaction, type Database } from './database.ts';
import type { HeatState } from './heat-engine.ts';

export interface HeatStore {
  /** The event's heats, or null. */
  load(eventId: number): HeatState | null;
  /**
   * Stores `state` as the event's heats. Other heats the event has are replaced, and the rows
   * of these are rewritten to match, in one transaction.
   */
  save(eventId: number, state: HeatState): void;
  /** Removes the event's heats. True if there were any. */
  remove(eventId: number): boolean;
  /** The id the next heats will get. Never reused, even after a delete. */
  nextRunId(): number;
  /** The id the next result will get. Never reused, so an old result id can't name a new result. */
  nextResultId(): number;
  /** True if the player is in the event's heats, running or finished, on time or late. */
  hasPlayer(eventId: number, playerId: number): boolean;
}

export function createHeatStore(db: Database): HeatStore {
  const byEvent = db.prepare('SELECT id, stations, races, rounds, points, seeding, created_at FROM heat_runs WHERE event_id = ?');
  const results = db.prepare(
    'SELECT id, heat_id, finish_order, missing, at, undone_step, undone_at FROM heat_results WHERE run_id = ? ORDER BY id',
  );
  const lateJoins = db.prepare('SELECT player_id, heat_id, step FROM heat_late_joins WHERE run_id = ? ORDER BY position');
  const tieBreaks = db.prepare('SELECT players, step FROM heat_tie_breaks WHERE run_id = ? ORDER BY position');
  const removeForEvent = db.prepare('DELETE FROM heat_runs WHERE event_id = ? AND id <> ?');
  const removeAll = db.prepare('DELETE FROM heat_runs WHERE event_id = ?');
  const exists = db.prepare('SELECT 1 AS found FROM heat_runs WHERE id = ?');
  const insertRun = db.prepare(
    'INSERT INTO heat_runs (id, event_id, stations, races, rounds, points, seeding, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const updateSeeding = db.prepare('UPDATE heat_runs SET seeding = ? WHERE id = ?');
  const clearResults = db.prepare('DELETE FROM heat_results WHERE run_id = ?');
  const clearLate = db.prepare('DELETE FROM heat_late_joins WHERE run_id = ?');
  const clearTies = db.prepare('DELETE FROM heat_tie_breaks WHERE run_id = ?');
  const insertResult = db.prepare(
    'INSERT INTO heat_results (id, run_id, heat_id, finish_order, missing, at, undone_step, undone_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertLate = db.prepare('INSERT INTO heat_late_joins (run_id, position, player_id, heat_id, step) VALUES (?, ?, ?, ?, ?)');
  const insertTie = db.prepare('INSERT INTO heat_tie_breaks (run_id, position, players, step) VALUES (?, ?, ?, ?)');
  const sequence = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?');
  // json_each lists the seeding's player ids. A late player is in their own table, and a
  // tie-break's players are all players of the run already.
  const holds = db.prepare(
    `SELECT 1 AS found FROM heat_runs r
     WHERE r.event_id = ?1
       AND (EXISTS (SELECT 1 FROM json_each(r.seeding) j WHERE j.value = ?2)
         OR EXISTS (SELECT 1 FROM heat_late_joins l WHERE l.run_id = r.id AND l.player_id = ?2))`,
  );

  // AUTOINCREMENT keeps the highest id ever given in sqlite_sequence, which also counts an id
  // inserted by hand, so the next one is one past it.
  const next = (table: string): number => {
    const row = sequence.get(table);
    return (row ? (row['seq'] as number) : 0) + 1;
  };

  return {
    load(eventId) {
      const row = byEvent.get(eventId);
      if (!row) return null;
      const id = row['id'] as number;
      return {
        settings: {
          id,
          stations: row['stations'] as number,
          races: row['races'] as RacesPerHeat,
          rounds: row['rounds'] as number,
          points: JSON.parse(row['points'] as string) as number[],
          createdAt: row['created_at'] as string,
        },
        seeding: JSON.parse(row['seeding'] as string) as number[],
        lateJoins: lateJoins.all(id).map((r) => ({
          playerId: r['player_id'] as number,
          heatId: r['heat_id'] as number,
          step: r['step'] as number,
        })),
        results: results.all(id).map((r) => ({
          id: r['id'] as number,
          heatId: r['heat_id'] as number,
          order: JSON.parse(r['finish_order'] as string) as number[],
          at: r['at'] as string,
          // Both fields are left off a result that has no such mark, as the engine writes them.
          ...(r['missing'] === null ? {} : { missing: JSON.parse(r['missing'] as string) as number[] }),
          ...(r['undone_step'] === null ? {} : { undone: { step: r['undone_step'] as number, at: r['undone_at'] as string } }),
        })),
        tieBreaks: tieBreaks.all(id).map((r) => ({ players: JSON.parse(r['players'] as string) as number[], step: r['step'] as number })),
      };
    },
    save(eventId, state) {
      const { settings } = state;
      inTransaction(db, () => {
        removeForEvent.run(eventId, settings.id);
        const seeding = JSON.stringify(state.seeding);
        if (exists.get(settings.id)) {
          // The settings never change once the heats are made; seeding is rewritten with the rest.
          updateSeeding.run(seeding, settings.id);
          clearResults.run(settings.id);
          clearLate.run(settings.id);
          clearTies.run(settings.id);
        } else {
          insertRun.run(
            settings.id,
            eventId,
            settings.stations,
            settings.races,
            settings.rounds,
            JSON.stringify(settings.points),
            seeding,
            settings.createdAt,
          );
        }
        for (const r of state.results) {
          insertResult.run(
            r.id,
            settings.id,
            r.heatId,
            JSON.stringify(r.order),
            r.missing ? JSON.stringify(r.missing) : null,
            r.at,
            r.undone?.step ?? null,
            r.undone?.at ?? null,
          );
        }
        state.lateJoins.forEach((j, position) => insertLate.run(settings.id, position, j.playerId, j.heatId, j.step));
        state.tieBreaks.forEach((t, position) => insertTie.run(settings.id, position, JSON.stringify(t.players), t.step));
      });
    },
    remove: (eventId) => removeAll.run(eventId).changes > 0,
    nextRunId: () => next('heat_runs'),
    nextResultId: () => next('heat_results'),
    hasPlayer: (eventId, playerId) => holds.get(eventId, playerId) !== undefined,
  };
}
