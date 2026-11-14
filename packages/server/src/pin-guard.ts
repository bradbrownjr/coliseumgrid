// The one PIN check (docs/PLAN.md, "Player view", "Signing in, two ways"), used by the tablet's
// claim (POST /api/signup/claim) and the phone's follow (POST /api/phone/follow).
//
// Wrong PINs are counted per handle, 5 per 10 minutes (rate-limit.ts), in two counts:
//
// - The phone count locks phones. A wrong PIN on the phone route counts here, and online a
//   wrong PIN on the tablet's claim counts here too, so the tablet can't be used to get a
//   handle more phone tries than 5 in all.
// - The tablet count locks the tablet's claim, online only. Only the tablet's own wrong PINs
//   count here, so phone failures never lock the paired tablet (Brad, 2026-11-14): a stranger
//   typing wrong PINs on a phone can't stop a kid signing in at the sign-up tablet.
//
// Offline the tablet isn't limited (a wrong PIN only costs a retry), but a phone is, because
// phones aren't paired by the host. A phone is also limited per client IP in both modes.
//
// An attempt is reserved before the PIN is checked and cleared when it is right, so requests
// that arrive while the slow hash runs can't all slip past the limit.

import { isValidPin } from '@coliseumgrid/core';
import type { Mode } from './config.ts';
import { hashPin, verifyPin } from './pin-hash.ts';
import {
  CLAIM_MAX_PER_IP,
  CLAIM_MAX_WRONG_PER_HANDLE,
  CLAIM_WINDOW_MS,
  FailureLimiter,
} from './rate-limit.ts';

export type PinVerdict = 'ok' | 'wrong-pin' | 'too-many-tries';

// What an unknown handle is checked against, so it costs the same scrypt run as a wrong PIN for
// a real handle and the two can't be told apart by timing. Made once per process.
const UNKNOWN_HANDLE_HASH = hashPin('0000');

export interface PinGuard {
  /** The tablet's claim. Limited per handle online only; the per-IP limit is on the route. */
  checkClaim(handleKey: string, pinHash: string, pin: string): Promise<PinVerdict>;
  /**
   * Reserves one follow try from a client (a getClientKey), so one address can't try many
   * handles. False when it has used up its tries. Only wrong tries are to stay counted: the
   * caller gives the try back with `refundFollowFrom` when the follow went through.
   */
  allowFollowFrom(ip: string): boolean;
  /** Gives back the try `allowFollowFrom` reserved. */
  refundFollowFrom(ip: string): void;
  /** A phone's follow, limited per handle in both modes. Call allowFollowFrom first. */
  checkFollow(handleKey: string, pinHash: string, pin: string): Promise<PinVerdict>;
  /**
   * A phone's follow for a handle nobody has. Spends the same hash as a wrong PIN, and keeps
   * no per-handle count: handles are chosen by the caller, so counting them would let one
   * address fill the limiter with made-up keys.
   */
  rejectUnknownHandle(pin: string): Promise<'wrong-pin'>;
  /** Forgets a handle's wrong PINs: after a right PIN, a rename, a merge, or a reset. */
  forget(handleKey: string): void;
}

/**
 * @param pinHashOf The player's current PIN hash by handle key, read again once the slow hash is done.
 */
export function createPinGuard(mode: Mode, now: () => number, pinHashOf: (handleKey: string) => string | undefined): PinGuard {
  const online = mode === 'online';
  const phoneLock = new FailureLimiter(CLAIM_MAX_WRONG_PER_HANDLE, CLAIM_WINDOW_MS, now);
  const tabletLock = new FailureLimiter(CLAIM_MAX_WRONG_PER_HANDLE, CLAIM_WINDOW_MS, now);
  const phonePerIp = new FailureLimiter(CLAIM_MAX_PER_IP, CLAIM_WINDOW_MS, now);

  /**
   * True when the PIN is right for the hash the caller read. The hash takes a moment, and the
   * host may reset the PIN meanwhile (or rename or merge the player): a PIN that matched the
   * old hash must not sign anyone in, so the hash is read again here. The caller writes in
   * the same turn: nothing else runs between this answer and the route's next statement.
   */
  async function proves(handleKey: string, pinHash: string, pin: string): Promise<'right' | 'wrong' | 'stale'> {
    // A string that can't be a PIN is wrong without paying for a hash.
    if (!isValidPin(pin) || !(await verifyPin(pin, pinHash))) return 'wrong';
    return pinHashOf(handleKey) === pinHash ? 'right' : 'stale';
  }

  return {
    async checkClaim(handleKey, pinHash, pin) {
      if (!online) return (await proves(handleKey, pinHash, pin)) === 'right' ? 'ok' : 'wrong-pin';
      // No await between here and the reservations, so concurrent guesses each take their own slot.
      if (!tabletLock.tryAttempt(handleKey)) return 'too-many-tries';
      // The answer is ignored on purpose: a handle whose phones are locked doesn't lock the tablet.
      const countedForPhones = phoneLock.tryAttempt(handleKey);
      const result = await proves(handleKey, pinHash, pin);
      if (result === 'right') {
        // Earlier mistypes don't carry over to the player's next sign-in.
        tabletLock.clear(handleKey);
        phoneLock.clear(handleKey);
        return 'ok';
      }
      if (result === 'stale') {
        // The PIN was right when it was typed: a reset made it wrong, so it isn't a guess.
        tabletLock.refund(handleKey);
        if (countedForPhones) phoneLock.refund(handleKey);
      }
      return 'wrong-pin';
    },
    allowFollowFrom: (ip) => phonePerIp.tryAttempt(ip),
    refundFollowFrom: (ip) => phonePerIp.refund(ip),
    async checkFollow(handleKey, pinHash, pin) {
      if (!phoneLock.tryAttempt(handleKey)) return 'too-many-tries';
      const result = await proves(handleKey, pinHash, pin);
      if (result === 'right') {
        // A right PIN clears both counts, as a right claim does.
        phoneLock.clear(handleKey);
        tabletLock.clear(handleKey);
        return 'ok';
      }
      if (result === 'stale') phoneLock.refund(handleKey);
      return 'wrong-pin';
    },
    async rejectUnknownHandle(pin) {
      if (isValidPin(pin)) await verifyPin(pin, await UNKNOWN_HANDLE_HASH);
      return 'wrong-pin';
    },
    forget(handleKey) {
      phoneLock.clear(handleKey);
      tabletLock.clear(handleKey);
    },
  };
}
