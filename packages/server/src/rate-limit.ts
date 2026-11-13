// The limits on guessing. PINs at POST /api/signup/claim are limited online only (docs/PLAN.md,
// section 4): offline, a wrong PIN only costs a retry. Host passwords and pairing codes are
// limited in both modes (CLAUDE.md, rule 7).

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

/** The window for wrong host passwords and wrong pairing codes. */
export const GUESS_WINDOW_MS = 10 * 60 * 1000;

/**
 * Wrong host passwords per client IP per window, in both modes (CLAUDE.md, rule 7). 10 is room
 * for a host who mistypes a few times, and averages one guess a minute: against a password of
 * 8 or more characters that is no progress at all. Counted per IP, so at an online venue
 * behind one public address a stranger on the same network can also lock the host out for
 * the window. Restarting the server clears the counts.
 */
export const SIGN_IN_MAX_WRONG_PER_IP = 10;

/**
 * Wrong pairing codes per client IP per window, in both modes (rule 7). A code has 27^6, about
 * 387 million, values and only a few are live at once, so 10 guesses a window find one with a
 * chance of about 1 in 40 million per live code. 10 also leaves room for someone typing a code
 * with a TV remote to get it wrong a few times.
 */
export const JOIN_MAX_WRONG_PER_IP = 10;

/**
 * Wrong pairing codes across all callers per window, in both modes, on top of the per-IP limit
 * (rule 7). The per-IP limit means nothing against a caller with many addresses, such as an
 * IPv6 range or a botnet. A code has 27^6, about 387 million, values and a few are live at
 * once (they last 10 minutes, the same as this window), so with 5 live codes 100 wrong
 * guesses find one with a chance of about 1 in 775,000 per window, and a day of nonstop
 * guessing about 1 in 5,400. 100 is far above what real typos reach: even a full room
 * behind one address is held to 10 by the per-IP limit. Once it is used up, every join
 * answers 429 until the window ends, so someone with many addresses can keep new devices from
 * pairing; the host can still pair after the window or restart the server.
 */
export const JOIN_MAX_WRONG_GLOBAL = 100;

/**
 * Keys one limiter holds before it refuses new ones. A key lives one window, so this is the
 * number of distinct callers (or handles) per window the limiter can follow: far above any
 * event, small enough that a flood of made-up keys can't grow the map without bound. When the
 * map is full a new key is blocked, so the limit fails closed.
 */
export const LIMITER_MAX_KEYS = 10_000;

/**
 * Counts attempts per key in a fixed window that starts at a key's first attempt. A caller
 * reserves an attempt before the slow check and clears the key when the check passes, so
 * requests running at once can't all slip past the limit while the check is in flight.
 *
 * Holds at most `maxKeys` keys. Every window is the same length, and a key moves to the end of
 * the map when its window starts, so the map is ordered by expiry and cleaning up is only a
 * matter of dropping keys from the front until one is still live. That costs a little per
 * call, however many keys there are.
 */
export class FailureLimiter {
  readonly #max: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #maxKeys: number;
  readonly #entries = new Map<string, { count: number; resetAt: number }>();

  constructor(max: number, windowMs: number, now: () => number = Date.now, maxKeys: number = LIMITER_MAX_KEYS) {
    this.#max = max;
    this.#windowMs = windowMs;
    this.#now = now;
    this.#maxKeys = maxKeys;
  }

  /**
   * Counts one attempt and returns true, or returns false (counting nothing) when the key has
   * used up its attempts for this window, or when it is a new key and the map is full.
   * Synchronous, so no other request runs between the check and the count.
   */
  tryAttempt(key: string): boolean {
    const now = this.#now();
    const entry = this.#entries.get(key);
    if (entry !== undefined && entry.resetAt > now) {
      if (entry.count >= this.#max) return false;
      entry.count++;
      return true;
    }
    this.#dropExpired(now);
    // Deleted first so the key goes to the end of the map, where its new expiry belongs.
    this.#entries.delete(key);
    if (this.#entries.size >= this.#maxKeys) return false;
    this.#entries.set(key, { count: 1, resetAt: now + this.#windowMs });
    return true;
  }

  /** Forgets the key's attempts. */
  clear(key: string): void {
    this.#entries.delete(key);
  }

  /** Gives back one attempt, for a caller that reserved one and then found the attempt was fine. */
  refund(key: string): void {
    const entry = this.#entries.get(key);
    if (entry !== undefined && entry.count > 0) entry.count--;
  }

  #dropExpired(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.resetAt > now) break;
      this.#entries.delete(key);
    }
  }
}
