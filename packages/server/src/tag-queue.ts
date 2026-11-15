// The print queue (docs/PLAN.md, "The print queue"): the name tags waiting to print, at most one
// per player. The server stores only a hash of each PIN, so a sign-up, a claim, a host add, and
// a PIN reset queue the tag with the plain PIN they just saw; it stays until the host says the
// tag printed, or for 12 hours, whichever is first. A 4-digit PIN's hash can be reversed in
// moments anyway, so the short-lived plain copy adds little risk (Brad, 2026-11-15).
//
// Every statement names its columns. The queue reaches the host only (CLAUDE.md, rule 1, and
// PLAN.md: "The queue is never sent to a phone or a Sign-up device").

import type { NameTag } from '@coliseumgrid/core';
import { iso, type Clock } from './clock.ts';
import type { Database } from './database.ts';

/** A plain PIN still queued this long after it was stored is wiped, and its tag prints without it. */
export const TAG_PIN_MAX_MS = 12 * 60 * 60 * 1000;

export interface TagQueue {
  /** Every queued tag with the player's current handle, sorted by handle like the players list. */
  list(): NameTag[];
  get(playerId: number): NameTag | undefined;
  /**
   * Queues the player's tag. A tag already queued is replaced, and its PIN is kept when the new
   * one has none (a reprint), so the newest PIN seen is the one that prints.
   */
  queue(playerId: number, pin: string | null): void;
  /** Deletes these tags and their PINs. Returns how many were queued. */
  printed(playerIds: number[]): number;
  /** Deletes the player's tag. True if there was one. */
  remove(playerId: number): boolean;
  /** Empties the queue, for a new event. Returns how many tags were deleted. */
  clear(): number;
  /** Wipes every PIN stored `maxAgeMs` or longer ago; the tags stay queued. Returns how many were wiped. */
  wipeOldPins(maxAgeMs: number): number;
}

export function createTagQueue(db: Database, now: Clock): TagQueue {
  const list = db.prepare(
    'SELECT q.player_id, p.handle, q.pin FROM tag_queue q JOIN players p ON p.id = q.player_id ORDER BY p.handle_key, p.id',
  );
  const get = db.prepare('SELECT q.player_id, p.handle, q.pin FROM tag_queue q JOIN players p ON p.id = q.player_id WHERE q.player_id = ?');
  // A reprint (no PIN) keeps the PIN already queued and the time it was stored, so the 12-hour
  // limit still counts from when the PIN was seen.
  const upsert = db.prepare(`
    INSERT INTO tag_queue (player_id, pin, pin_stored_at, queued_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (player_id) DO UPDATE SET
      pin = coalesce(excluded.pin, tag_queue.pin),
      pin_stored_at = CASE WHEN excluded.pin IS NULL THEN tag_queue.pin_stored_at ELSE excluded.pin_stored_at END,
      queued_at = excluded.queued_at
  `);
  const removeMany = db.prepare('DELETE FROM tag_queue WHERE player_id IN (SELECT value FROM json_each(?))');
  const removeOne = db.prepare('DELETE FROM tag_queue WHERE player_id = ?');
  const removeAll = db.prepare('DELETE FROM tag_queue');
  const wipe = db.prepare('UPDATE tag_queue SET pin = NULL, pin_stored_at = NULL WHERE pin_stored_at <= ?');

  const asTag = (row: Record<string, unknown>): NameTag => ({
    playerId: row['player_id'] as number,
    handle: row['handle'] as string,
    pin: (row['pin'] as string | null) ?? null,
  });

  /**
   * secure_delete (database.ts) zeroes a removed PIN in the page, but the WAL still holds the
   * page as it was until a checkpoint copies the new one over it. TRUNCATE also empties the WAL
   * file (https://sqlite.org/pragma.html#pragma_wal_checkpoint). An in-memory database has no
   * WAL, and the pragma does nothing there.
   */
  const scrub = (changes: number): number => {
    if (changes > 0) db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return changes;
  };

  return {
    list: () => list.all().map(asTag),
    get(playerId) {
      const row = get.get(playerId);
      return row && asTag(row);
    },
    queue(playerId, pin) {
      const at = iso(now());
      upsert.run(playerId, pin, pin === null ? null : at, at);
    },
    printed: (playerIds) => scrub(Number(removeMany.run(JSON.stringify(playerIds)).changes)),
    remove: (playerId) => scrub(Number(removeOne.run(playerId).changes)) > 0,
    clear: () => scrub(Number(removeAll.run().changes)),
    wipeOldPins: (maxAgeMs) => scrub(Number(wipe.run(iso(now() - maxAgeMs)).changes)),
  };
}
