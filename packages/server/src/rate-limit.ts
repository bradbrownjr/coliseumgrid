// Limits on guessing PINs at POST /api/signup/claim. Online only (docs/PLAN.md, section 4):
// offline, a wrong PIN only costs a retry.

/** The window both limits use. Long enough to blunt guessing, short enough that a kid who locked a handle is back soon. */
export const CLAIM_WINDOW_MS = 10 * 60 * 1000;

/**
 * Wrong PINs per handle per window. The PIN has 10,000 values, so this is the real guard: 5
 * tries gives an attacker at most 5 chances in 10,000 per window against one handle, while a
 * kid who mistypes twice is not locked out.
 */
export const CLAIM_MAX_WRONG_PER_HANDLE = 5;

/**
 * Claims per client IP per window, right or wrong. Online, every tablet at a venue arrives
 * from the venue's one public address, so this must let a room of returning players sign in
 * (one claim each) and only stops one address trying many handles.
 */
export const CLAIM_MAX_PER_IP = 60;

/**
 * Counts attempts per key in a fixed window that starts at a key's first attempt. A caller
 * reserves an attempt before the slow check and clears the key when the check passes, so
 * requests running at once can't all slip past the limit while the check is in flight.
 */
export class FailureLimiter {
  readonly #max: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #entries = new Map<string, { count: number; resetAt: number }>();

  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    this.#max = max;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  /**
   * Counts one attempt and returns true, or returns false (counting nothing) when the key has
   * used up its attempts for this window. Synchronous, so no other request runs between the
   * check and the count.
   */
  tryAttempt(key: string): boolean {
    const now = this.#now();
    const entry = this.#entries.get(key);
    if (entry === undefined || entry.resetAt <= now) {
      this.#sweep(now);
      this.#entries.set(key, { count: 1, resetAt: now + this.#windowMs });
      return true;
    }
    if (entry.count >= this.#max) return false;
    entry.count++;
    return true;
  }

  /** Forgets the key's attempts. */
  clear(key: string): void {
    this.#entries.delete(key);
  }

  // Keys are only reserved for handles that exist, so the map is bounded by the player
  // count; dropping expired keys as new ones arrive keeps it at the active ones.
  #sweep(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.resetAt <= now) this.#entries.delete(key);
    }
  }
}
