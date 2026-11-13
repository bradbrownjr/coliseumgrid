// Session and device tokens (docs/PLAN.md, "Devices and host API"). A token is 32 random bytes
// from node:crypto, sent to its owner once (in a cookie) and stored only as a SHA-256 hash.
//
// SHA-256 is enough here, where PINs and passwords get scrypt (pin-hash.ts): a slow hash exists
// to make guessing a low-entropy secret expensive, and a random 256-bit token can't be guessed
// at any speed. The hash is there so a copied database file can't be used to sign in. The
// stored hash is also looked up directly, so a request's timing says nothing about the token.

import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;

/** A new random token, base64url so it is safe in a cookie value. */
export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** The hex SHA-256 of a token: what the database stores and looks up. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
