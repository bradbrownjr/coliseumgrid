// The bracket tables (docs/PLAN.md, "Brackets API"). The engine's `BracketState` goes in and
// comes out whole: a save rewrites the bracket's rows in one transaction, so the database
// equals the state exactly and a failed save leaves the old bracket untouched (CLAUDE.md,
// rule 5). Only ids, settings, and times are stored; a handle is read from `players` when an
// answer is made (CLAUDE.md, rule 1).

import type { BestOf, BracketFormat } from '@coliseumgrid/core';
import type { BracketState } from './bracket-engine.ts';
import { inTransaction, type Database } from './database.ts';

export interface BracketStore {
  /** The event's bracket, or null. */
  load(eventId: number): BracketState | null;
  /**
   * Stores `state` as the event's bracket. Another bracket the event has is replaced, and the
   * rows of this one are rewritten to match, in one transaction.
   */
  save(eventId: number, state: BracketState): void;
  /** Removes the event's bracket. True if there was one. */
  remove(eventId: number): boolean;
  /** The id the next bracket will get. Never reused, even after a delete. */
  nextBracketId(): number;
  /** The id the next result will get. Never reused, so an old result id can't name a new result. */
  nextResultId(): number;
  /** True if the player is in any bracket of the event, running or finished. */
  hasPlayer(eventId: number, playerId: number): boolean;
}

export function createBracketStore(db: Database): BracketStore {
  const byEvent = db.prepare('SELECT id, format, best_of, stations, seeding, created_at FROM brackets WHERE event_id = ?');
  const results = db.prepare('SELECT id, match_id, winner_id, loser_id, at FROM bracket_results WHERE bracket_id = ? ORDER BY id');
  const lateJoins = db.prepare('SELECT player_id, step FROM bracket_late_joins WHERE bracket_id = ? ORDER BY position');
  const tieBreaks = db.prepare(
    'SELECT round, player_a, player_b, step FROM bracket_tie_breaks WHERE bracket_id = ? ORDER BY position',
  );
  const removeForEvent = db.prepare('DELETE FROM brackets WHERE event_id = ? AND id <> ?');
  const removeAll = db.prepare('DELETE FROM brackets WHERE event_id = ?');
  const exists = db.prepare('SELECT 1 AS found FROM brackets WHERE id = ?');
  const insertBracket = db.prepare(
    'INSERT INTO brackets (id, event_id, format, best_of, stations, seeding, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const updateSeeding = db.prepare('UPDATE brackets SET seeding = ? WHERE id = ?');
  const clearResults = db.prepare('DELETE FROM bracket_results WHERE bracket_id = ?');
  const clearLate = db.prepare('DELETE FROM bracket_late_joins WHERE bracket_id = ?');
  const clearTies = db.prepare('DELETE FROM bracket_tie_breaks WHERE bracket_id = ?');
  const insertResult = db.prepare(
    'INSERT INTO bracket_results (id, bracket_id, match_id, winner_id, loser_id, at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertLate = db.prepare('INSERT INTO bracket_late_joins (bracket_id, position, player_id, step) VALUES (?, ?, ?, ?)');
  const insertTie = db.prepare(
    'INSERT INTO bracket_tie_breaks (bracket_id, position, round, player_a, player_b, step) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const sequence = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?');
  // json_each lists the seeding's entries; empty slots are JSON nulls and never equal an id.
  const holds = db.prepare(
    'SELECT 1 AS found FROM brackets b, json_each(b.seeding) j WHERE b.event_id = ? AND j.value = ? LIMIT 1',
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
          format: row['format'] as BracketFormat,
          bestOf: row['best_of'] as BestOf,
          stations: row['stations'] as number,
          createdAt: row['created_at'] as string,
        },
        seeding: JSON.parse(row['seeding'] as string) as Array<number | null>,
        lateJoins: lateJoins.all(id).map((r) => ({ playerId: r['player_id'] as number, step: r['step'] as number })),
        results: results.all(id).map((r) => ({
          id: r['id'] as number,
          matchId: r['match_id'] as number,
          winnerId: r['winner_id'] as number,
          loserId: r['loser_id'] as number,
          at: r['at'] as string,
        })),
        tieBreaks: tieBreaks.all(id).map((r) => ({
          round: r['round'] as number,
          players: [r['player_a'] as number, r['player_b'] as number] as [number, number],
          step: r['step'] as number,
        })),
      };
    },
    save(eventId, state) {
      const { settings } = state;
      inTransaction(db, () => {
        removeForEvent.run(eventId, settings.id);
        const seeding = JSON.stringify(state.seeding);
        if (exists.get(settings.id)) {
          // The settings never change after the bracket is made; a late join changes the seeding.
          updateSeeding.run(seeding, settings.id);
          clearResults.run(settings.id);
          clearLate.run(settings.id);
          clearTies.run(settings.id);
        } else {
          insertBracket.run(settings.id, eventId, settings.format, settings.bestOf, settings.stations, seeding, settings.createdAt);
        }
        for (const r of state.results) insertResult.run(r.id, settings.id, r.matchId, r.winnerId, r.loserId, r.at);
        state.lateJoins.forEach((j, position) => insertLate.run(settings.id, position, j.playerId, j.step));
        state.tieBreaks.forEach((t, position) => insertTie.run(settings.id, position, t.round, t.players[0], t.players[1], t.step));
      });
    },
    remove: (eventId) => removeAll.run(eventId).changes > 0,
    nextBracketId: () => next('brackets'),
    nextResultId: () => next('bracket_results'),
    hasPlayer: (eventId, playerId) => holds.get(eventId, playerId) !== undefined,
  };
}
