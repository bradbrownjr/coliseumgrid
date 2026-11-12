// A player's optional PIN: 4 digits, suggested at sign-up so choosing one never holds up the
// line (docs/PLAN.md, section 4). Hashing and checking a stored PIN needs node:crypto, so
// that belongs to the server, not here (CLAUDE.md, rule 4).

import type { RandomSource } from './random.ts';

export const PIN_LENGTH = 4;

/** A random PIN, "0000" to "9999". Leading zeros stay, so the result is always a string. */
export function suggestPin(random: RandomSource): string {
  return String(Math.floor(random() * 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, '0');
}

/** True for exactly 4 digits, 0 to 9 (not other scripts' digits). */
export function isValidPin(pin: string): boolean {
  return /^[0-9]{4}$/.test(pin);
}
