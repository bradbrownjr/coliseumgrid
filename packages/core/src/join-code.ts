// The code that pairs a TV or tablet with the host (docs/PLAN.md, section 3, "Pairing a
// device"). A person reads it off a TV across a room and types it with a remote, so every
// character has to be hard to mistake for another. Expiry, single use, and rate limiting
// need a clock and storage, so they belong to the server (CLAUDE.md, rules 4 and 7).

import type { RandomSource } from './random.ts';

// Dropped, and why:
// - 0, O, 1, I, L: the look-alikes docs/PLAN.md rules out. Crockford's Base32 drops the
//   same letters (I, L, O) for the same reason: https://www.crockford.com/base32.html
// - U: Crockford also drops it, because it is easy to read as V.
// - S, Z, B: read as 5, 2, and 8 on a TV. This is a judgment call, not from a published
//   standard (unverified): those are the usual digit and letter pairs in sans-serif type.
// What is left is 8 digits and 19 letters: 27 characters, so 27^6 (about 387 million)
// codes. That is plenty for a code that works once, lasts 10 minutes, and is rate limited.
export const JOIN_CODE_ALPHABET = '23456789ACDEFGHJKMNPQRTVWXY';
export const JOIN_CODE_LENGTH = 6;

// A random byte is 0 to 255. 27 * 9 = 243, so bytes 243 to 255 are thrown away and the rest
// split into 9 equal runs per character. No modulo bias. A seeded source gives multiples of
// 1 / 2^32, so floor(x * 256) is exactly uniform over 0 to 255 for it.
const BYTE_RANGE = 256;
const ACCEPT_BELOW = BYTE_RANGE - (BYTE_RANGE % JOIN_CODE_ALPHABET.length);

/** A random 6-character code from `JOIN_CODE_ALPHABET`, all uppercase, no separator. */
export function generateJoinCode(random: RandomSource): string {
  let code = '';
  while (code.length < JOIN_CODE_LENGTH) {
    const byte = Math.floor(random() * BYTE_RANGE);
    if (byte < ACCEPT_BELOW) code += JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length];
  }
  return code;
}

/** The code as shown on screen: two groups of three, like "K7M-4QX". */
export function formatJoinCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

// Typed letters that are not in the alphabet but have an obvious intended character. S, Z,
// and B were dropped for looking like 5, 2, and 8; U was dropped for looking like V. 0, O, 1,
// I, and L are not mapped: the alphabet has no character they could stand for, so a code
// that contains one is a typo and is refused.
const TYPED_AS: Readonly<Record<string, string>> = { S: '5', Z: '2', B: '8', U: 'V' };

/**
 * Reads what a person typed: any case, with spaces or hyphens anywhere (or none). Returns the
 * canonical 6-character code, or null when the length is wrong or a character can't be read.
 */
export function parseJoinCode(input: string): string | null {
  const typed = input.replace(/[\s-]/g, '').toUpperCase();
  if (typed.length !== JOIN_CODE_LENGTH) return null;
  let code = '';
  for (const char of typed) {
    const read = TYPED_AS[char] ?? char;
    if (!JOIN_CODE_ALPHABET.includes(read)) return null;
    code += read;
  }
  return code;
}
