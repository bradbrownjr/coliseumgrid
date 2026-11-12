// Hashing and checking a stored PIN with scrypt from node:crypto (docs/PLAN.md, section 4).
//
// The stored string is self-describing, `scrypt$N$r$p$salt$hash` with base64 salt and hash,
// so the cost can be raised later and old PINs still verify with the numbers they were
// hashed with.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Node's documented defaults for crypto.scrypt: cost 16384, blockSize 8, parallelization 1
// (https://nodejs.org/docs/latest-v26.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).
// OWASP's Password Storage Cheat Sheet lists N=2^14 only together with p=5
// (https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), about
// five times the time. That is not worth it here: a PIN has 10,000 possible values, so any
// scrypt cost falls to a guess of every one of them from a copied database in minutes. The
// PIN only stops one kid playing as another (docs/PLAN.md, section 4); the online rate limit
// is the guard against guessing at the tablet.
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 32;
// Node recommends a random salt of at least 16 bytes (NIST SP 800-132), per the same page.
const SALT_LENGTH = 16;

function derive(
  pin: string,
  salt: Buffer,
  keyLength: number,
  cost: number,
  blockSize: number,
  parallelization: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, keyLength, { cost, blockSize, parallelization }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(pin, salt, KEY_LENGTH, COST, BLOCK_SIZE, PARALLELIZATION);
  return ['scrypt', COST, BLOCK_SIZE, PARALLELIZATION, salt.toString('base64'), key.toString('base64')].join('$');
}

/** True when the PIN matches the stored string. A stored string that isn't ours never matches. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [cost, blockSize, parallelization] = [parts[1], parts[2], parts[3]].map(Number) as [number, number, number];
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelization)) return false;
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    // keylen follows the stored hash, so a change to KEY_LENGTH doesn't break old PINs.
    actual = await derive(pin, salt, expected.length, cost, blockSize, parallelization);
  } catch {
    // Parameters scrypt refuses (not a power of two, too much memory) mean a damaged string.
    return false;
  }
  // The lengths are equal by construction, which timingSafeEqual requires
  // (https://nodejs.org/docs/latest-v26.x/api/crypto.html#cryptotimingsafeequala-b).
  return timingSafeEqual(actual, expected);
}
