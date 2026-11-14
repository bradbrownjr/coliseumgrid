// Phones and what they follow (docs/PLAN.md, "Phone API"). A phone is a row with a token hash;
// the token itself is in the phone's cg_phone cookie and never stored. Every query names its
// columns, so token_hash stays in this file (CLAUDE.md, rule 1). The statements are
// synchronous, so a check followed by a write in the same tick can't be interleaved with
// another request. A phone that follows nobody doesn't exist: the last unfollow deletes it.

import { PHONE_FOLLOWS_MAX, type Player } from '@coliseumgrid/core';
import { iso, type Clock } from './clock.ts';
import { inTransaction, type Database } from './database.ts';

/**
 * A phone's last_seen is refreshed at most this often. A phone reloads on every result, so one
 * write a minute is enough to tell a live phone from a dead one.
 */
export const PHONE_SEEN_THROTTLE_MS = 60 * 1000;

/**
 * A phone not seen for this long is deleted, with its follows and push subscription. A phone
 * that is never signed out (the browser's data cleared, a phone given away) would otherwise
 * stay in the table and in every alert's fan-out for good. A phone in use is seen at least
 * once a minute while a page is open, so 90 days of nothing means it is gone.
 */
export const PHONE_IDLE_MAX_MS = 90 * 24 * 60 * 60 * 1000;

export interface PhoneRow {
  id: number;
}

export type FollowOutcome = 'added' | 'already' | 'full';

export interface Phones {
  getByTokenHash(tokenHash: string): PhoneRow | undefined;
  get(id: number): PhoneRow | undefined;
  /** Makes a phone that follows `playerId`, in one step. Returns its id. */
  create(tokenHash: string, playerId: number): number;
  /** Adds a follow. `full` when the phone already follows PHONE_FOLLOWS_MAX others. */
  follow(phoneId: number, playerId: number): FollowOutcome;
  /** How many players the phone follows. */
  count(phoneId: number): number;
  /** The players the phone follows, in the order it followed them, with their current handles. */
  following(phoneId: number): Player[];
  /**
   * Stops following. `signed-out` means that was the last one, and the phone is gone, with its
   * push subscription.
   */
  unfollow(phoneId: number, playerId: number): 'removed' | 'signed-out' | 'not-following';
  /** Deletes the phone (sign-out), with its follows and push subscription. */
  remove(phoneId: number): boolean;
  /** Removes the player from every phone's follows. Returns the phones left following nobody, which are deleted. */
  removePlayer(playerId: number): number[];
  /** A merge: every phone that followed `fromId` follows `toId` instead (or already did). */
  moveFollows(fromId: number, toId: number): void;
  /** Deletes the phones not seen since `olderThanMs` ago (follows and subscriptions go with them). Returns their ids. */
  purgeIdle(olderThanMs: number): number[];
  /** Sets last_seen to now. `throttled` skips the write when it was refreshed within PHONE_SEEN_THROTTLE_MS. */
  touch(id: number, throttled: boolean): void;
}

export function createPhones(db: Database, now: Clock): Phones {
  const byHash = db.prepare('SELECT id FROM phones WHERE token_hash = ?');
  const byId = db.prepare('SELECT id FROM phones WHERE id = ?');
  const insertPhone = db.prepare('INSERT INTO phones (token_hash, last_seen, created_at) VALUES (?, ?, ?)');
  const removePhone = db.prepare('DELETE FROM phones WHERE id = ?');
  const hasFollow = db.prepare('SELECT 1 AS found FROM phone_follows WHERE phone_id = ? AND player_id = ?');
  const countFollows = db.prepare('SELECT COUNT(*) AS n FROM phone_follows WHERE phone_id = ?');
  const insertFollow = db.prepare('INSERT INTO phone_follows (phone_id, player_id, created_at) VALUES (?, ?, ?)');
  const removeFollow = db.prepare('DELETE FROM phone_follows WHERE phone_id = ? AND player_id = ?');
  // rowid is the order the rows were made, which is the order the phone followed them.
  const listFollowing = db.prepare(
    'SELECT p.id, p.handle FROM phone_follows f JOIN players p ON p.id = f.player_id WHERE f.phone_id = ? ORDER BY f.rowid',
  );
  const phonesOfPlayer = db.prepare('SELECT phone_id FROM phone_follows WHERE player_id = ?');
  const removeFollowsOfPlayer = db.prepare('DELETE FROM phone_follows WHERE player_id = ?');
  const moveRows = db.prepare(
    'INSERT OR IGNORE INTO phone_follows (phone_id, player_id, created_at) SELECT phone_id, ?, created_at FROM phone_follows WHERE player_id = ?',
  );
  const idlePhones = db.prepare('SELECT id FROM phones WHERE last_seen < ?');
  const touchAlways = db.prepare('UPDATE phones SET last_seen = ? WHERE id = ?');
  const touchOld = db.prepare('UPDATE phones SET last_seen = ? WHERE id = ? AND last_seen <= ?');

  const count = (phoneId: number): number => Number(countFollows.get(phoneId)?.['n'] ?? 0);

  return {
    getByTokenHash(tokenHash) {
      const row = byHash.get(tokenHash);
      return row && { id: row['id'] as number };
    },
    get(id) {
      const row = byId.get(id);
      return row && { id: row['id'] as number };
    },
    create(tokenHash, playerId) {
      const at = iso(now());
      return inTransaction(db, () => {
        const id = Number(insertPhone.run(tokenHash, at, at).lastInsertRowid);
        insertFollow.run(id, playerId, at);
        return id;
      });
    },
    follow(phoneId, playerId) {
      if (hasFollow.get(phoneId, playerId)) return 'already';
      if (count(phoneId) >= PHONE_FOLLOWS_MAX) return 'full';
      insertFollow.run(phoneId, playerId, iso(now()));
      return 'added';
    },
    count,
    following: (phoneId) => listFollowing.all(phoneId).map((row) => ({ id: row['id'] as number, handle: row['handle'] as string })),
    unfollow(phoneId, playerId) {
      return inTransaction(db, () => {
        if (removeFollow.run(phoneId, playerId).changes === 0) return 'not-following';
        if (count(phoneId) > 0) return 'removed';
        removePhone.run(phoneId);
        return 'signed-out';
      });
    },
    remove: (phoneId) => removePhone.run(phoneId).changes > 0,
    removePlayer(playerId) {
      return inTransaction(db, () => {
        const affected = phonesOfPlayer.all(playerId).map((row) => row['phone_id'] as number);
        removeFollowsOfPlayer.run(playerId);
        const gone = affected.filter((id) => count(id) === 0);
        for (const id of gone) removePhone.run(id);
        return gone;
      });
    },
    moveFollows(fromId, toId) {
      // The rows of the merged player go with their deletion (ON DELETE CASCADE).
      moveRows.run(toId, fromId);
    },
    purgeIdle(olderThanMs) {
      const cutoff = iso(now() - olderThanMs);
      return inTransaction(db, () => {
        const ids = idlePhones.all(cutoff).map((row) => row['id'] as number);
        for (const id of ids) removePhone.run(id);
        return ids;
      });
    },
    touch(id, throttled) {
      const at = now();
      if (throttled) touchOld.run(iso(at), id, iso(at - PHONE_SEEN_THROTTLE_MS));
      else touchAlways.run(iso(at), id);
    },
  };
}
