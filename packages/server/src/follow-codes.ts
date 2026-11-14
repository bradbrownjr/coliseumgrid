// Follow codes (docs/PLAN.md, "Player view", "Signing in, two ways"): the code in the QR on the
// Sign-up done screen. It follows the pairing code rules (devices.ts): the same alphabet and
// length, works once, expires after 10 minutes, and is spent with one UPDATE that checks
// "unused and not expired" in its WHERE clause, so two requests with the same code can't both
// win. A player has at most one live code: a new one replaces it.

import { generateJoinCode, type FollowCode, type RandomSource } from '@coliseumgrid/core';
import { iso, type Clock } from './clock.ts';
import { inTransaction, type Database } from './database.ts';
import { PAIRING_CODE_MS } from './devices.ts';

/** A follow code lives as long as a pairing code. */
export const FOLLOW_CODE_MS = PAIRING_CODE_MS;

export interface FollowCodes {
  /** Makes a code for the player. Call it only after the player's PIN was set or proven. */
  create(playerId: number, random: RandomSource): FollowCode;
  /** Spends the (canonical) code. Returns the player it follows, or null for an unknown, used, or expired code. */
  spend(code: string): number | null;
  /** Drops the player's codes, for a PIN reset. */
  removeForPlayer(playerId: number): void;
}

export function createFollowCodes(db: Database, now: Clock): FollowCodes {
  const purge = db.prepare('DELETE FROM follow_codes WHERE expires_at <= ? OR used_at IS NOT NULL');
  const removeForPlayer = db.prepare('DELETE FROM follow_codes WHERE player_id = ?');
  const find = db.prepare('SELECT 1 AS taken FROM follow_codes WHERE code = ?');
  const insert = db.prepare('INSERT INTO follow_codes (code, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)');
  const spend = db.prepare(
    'UPDATE follow_codes SET used_at = ? WHERE code = ? AND used_at IS NULL AND expires_at > ? RETURNING player_id',
  );

  return {
    create(playerId, random) {
      const at = now();
      return inTransaction(db, () => {
        // Spent and expired codes go now, and so does the player's earlier code, so a new code
        // can't collide with a dead one and a player never has two live.
        purge.run(iso(at));
        removeForPlayer.run(playerId);
        let code = generateJoinCode(random);
        while (find.get(code)) code = generateJoinCode(random);
        const expiresAt = iso(at + FOLLOW_CODE_MS);
        insert.run(code, playerId, iso(at), expiresAt);
        return { code, expiresAt };
      });
    },
    spend(code) {
      const at = iso(now());
      const row = spend.get(at, code, at);
      return row ? (row['player_id'] as number) : null;
    },
    removeForPlayer: (playerId) => {
      removeForPlayer.run(playerId);
    },
  };
}
