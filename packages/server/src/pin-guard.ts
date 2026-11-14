// The one PIN check (docs/PLAN.md, "Player view", "Signing in, two ways"), used by the tablet's
// claim (POST /api/signup/claim) and the phone's follow (POST /api/phone/follow), so the same
// wrong-guess counts apply to both.
//
// Wrong PINs are counted per handle: 5 per 10 minutes (rate-limit.ts). Online, the tablet and
// the phone share that count, so one handle gets 5 guesses in total, not 5 on each. Offline the
// tablet isn't limited (a wrong PIN only costs a retry), but a phone is, because phones aren't
// paired by the host. A phone is also limited per client IP in both modes, right or wrong.
//
// An attempt is reserved before the PIN is checked and cleared when it is right, so requests
// that arrive while the slow hash runs can't all slip past the limit.

import { isValidPin } from '@coliseumgrid/core';
import type { Mode } from './config.ts';
import { verifyPin } from './pin-hash.ts';
import {
  CLAIM_MAX_PER_IP,
  CLAIM_MAX_WRONG_PER_HANDLE,
  CLAIM_WINDOW_MS,
  FailureLimiter,
} from './rate-limit.ts';

export type PinVerdict = 'ok' | 'wrong-pin' | 'too-many-tries';

export interface PinGuard {
  /** The tablet's claim. Limited per handle online only; the per-IP limit is on the route. */
  checkClaim(handleKey: string, pinHash: string, pin: string): Promise<PinVerdict>;
  /**
   * Counts one follow try from a client (a getClientKey), right or wrong or for an unknown
   * handle, so one address can't try many handles. False when it has used up its tries.
   */
  allowFollowFrom(ip: string): boolean;
  /** A phone's follow, limited per handle in both modes. Call allowFollowFrom first. */
  checkFollow(handleKey: string, pinHash: string, pin: string): Promise<PinVerdict>;
  /** Forgets a handle's wrong PINs: after a right PIN, a rename, a merge, or a reset. */
  forget(handleKey: string): void;
}

export function createPinGuard(mode: Mode, now: () => number): PinGuard {
  const online = mode === 'online';
  const perHandle = new FailureLimiter(CLAIM_MAX_WRONG_PER_HANDLE, CLAIM_WINDOW_MS, now);
  const phonePerIp = new FailureLimiter(CLAIM_MAX_PER_IP, CLAIM_WINDOW_MS, now);

  async function check(handleKey: string, limited: boolean, pinHash: string, pin: string): Promise<PinVerdict> {
    // No await between here and the reservation, so concurrent guesses each take their own slot.
    if (limited && !perHandle.tryAttempt(handleKey)) return 'too-many-tries';
    // A string that can't be a PIN is wrong without paying for a hash.
    if (!isValidPin(pin) || !(await verifyPin(pin, pinHash))) return 'wrong-pin';
    // Earlier mistypes don't carry over to the player's next sign-in.
    perHandle.clear(handleKey);
    return 'ok';
  }

  return {
    checkClaim: (handleKey, pinHash, pin) => check(handleKey, online, pinHash, pin),
    allowFollowFrom: (ip) => phonePerIp.tryAttempt(ip),
    checkFollow: (handleKey, pinHash, pin) => check(handleKey, true, pinHash, pin),
    forget: (handleKey) => perHandle.clear(handleKey),
  };
}
