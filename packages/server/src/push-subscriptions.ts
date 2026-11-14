// Push subscriptions (docs/PLAN.md, "Phone API", "Storage"): one per phone, the browser's
// endpoint and keys from `PushSubscription.toJSON()`. The keys are secrets between the phone
// and the server, so this file is the only place that reads them back, and they never go
// into an answer (CLAUDE.md, rule 1).

import { iso, type Clock } from './clock.ts';
import { inTransaction, type Database } from './database.ts';

/**
 * Subscriptions kept per player: the phones following one player that have alerts on. A player
 * has a PIN and a handle and one or two real phones, so 10 is room for a family and a few
 * browsers. Without a cap, someone who knows a PIN could sign in as many phones as they like
 * and make every alert for that player send to all of them.
 */
export const PUSH_SUBSCRIPTIONS_PER_PLAYER_MAX = 10;

export interface StoredSubscription {
  phoneId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSubscriptions {
  /**
   * Stores the phone's subscription, replacing its old one. Another phone holding the same
   * endpoint loses it: one browser that signed in as a new phone is the same browser.
   */
  set(phoneId: number, subscription: Omit<StoredSubscription, 'phoneId'>): void;
  /**
   * Drops the oldest subscriptions of the phones following the player beyond
   * PUSH_SUBSCRIPTIONS_PER_PLAYER_MAX. A phone's age here is when it came to count for the
   * player: the later of its subscribing and its following. Call it when either happens.
   */
  trimPlayer(playerId: number): void;
  /** Deletes the phone's subscription. */
  remove(phoneId: number): void;
  /** Deletes the subscription with this endpoint, when the push service said it is gone. */
  removeEndpoint(endpoint: string): void;
  /** Every subscription of a phone that follows the player. */
  forPlayer(playerId: number): StoredSubscription[];
}

export function createPushSubscriptions(db: Database, now: Clock): PushSubscriptions {
  const removeOthers = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND phone_id <> ?');
  const upsert = db.prepare(
    `INSERT INTO push_subscriptions (phone_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (phone_id) DO UPDATE SET endpoint = excluded.endpoint, p256dh = excluded.p256dh,
       auth = excluded.auth, created_at = excluded.created_at`,
  );
  const removePhone = db.prepare('DELETE FROM push_subscriptions WHERE phone_id = ?');
  const removeByEndpoint = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
  const followedBy = db.prepare('SELECT player_id FROM phone_follows WHERE phone_id = ?');
  // Newest first, so OFFSET skips the ones that stay. The phone id breaks a tie in the clock:
  // a higher id is a newer phone.
  const trim = db.prepare(
    `DELETE FROM push_subscriptions WHERE phone_id IN (
       SELECT s.phone_id FROM push_subscriptions s JOIN phone_follows f ON f.phone_id = s.phone_id
       WHERE f.player_id = ?
       ORDER BY MAX(s.created_at, f.created_at) DESC, s.phone_id DESC
       LIMIT -1 OFFSET ${PUSH_SUBSCRIPTIONS_PER_PLAYER_MAX})`,
  );
  const forPlayer = db.prepare(
    `SELECT s.phone_id, s.endpoint, s.p256dh, s.auth
     FROM push_subscriptions s JOIN phone_follows f ON f.phone_id = s.phone_id
     WHERE f.player_id = ? ORDER BY s.phone_id`,
  );

  return {
    set(phoneId, subscription) {
      inTransaction(db, () => {
        removeOthers.run(subscription.endpoint, phoneId);
        upsert.run(phoneId, subscription.endpoint, subscription.p256dh, subscription.auth, iso(now()));
        for (const row of followedBy.all(phoneId)) trim.run(row['player_id'] as number);
      });
    },
    trimPlayer: (playerId) => {
      trim.run(playerId);
    },
    remove: (phoneId) => {
      removePhone.run(phoneId);
    },
    removeEndpoint: (endpoint) => {
      removeByEndpoint.run(endpoint);
    },
    forPlayer: (playerId) =>
      forPlayer.all(playerId).map((row) => ({
        phoneId: row['phone_id'] as number,
        endpoint: row['endpoint'] as string,
        p256dh: row['p256dh'] as string,
        auth: row['auth'] as string,
      })),
  };
}
