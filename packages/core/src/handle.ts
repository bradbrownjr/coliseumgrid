// The rules for a player's handle (docs/PLAN.md, section 4). The client calls checkHandle to
// give quick feedback; the server calls it again on every sign-up and rename and trusts only
// its own answer (CLAUDE.md, rule 2). Both get the same verdict because it lives here.
//
// A handle is 2 to 16 characters (Brad, 2026-11-12): ASCII letters, digits, spaces, and
// . - _ . ASCII only, because the vulgarity filter reads A-Z, and a Cyrillic or accented
// look-alike would slip past it. Handles are shown as typed and compared without regard to
// case.

import { isVulgar } from './vulgarity.ts';

export const HANDLE_MIN = 2;
export const HANDLE_MAX = 16;

const ALLOWED = /^[A-Za-z0-9 ._-]*$/;

/** Why a handle was turned down. The client maps each code to words a kid can follow. */
export type HandleRefusal = 'too-short' | 'too-long' | 'bad-characters' | 'not-allowed';

export type HandleCheck =
  | {
      ok: true;
      /** The handle as it is stored and shown: trimmed, with runs of spaces collapsed. */
      handle: string;
      /** What uniqueness compares. Two handles with the same key are the same player. */
      key: string;
    }
  | { ok: false; reason: HandleRefusal };

/**
 * Trims the ends and collapses each run of spaces to one. A slip of the thumb on a tablet
 * (a trailing space, a doubled space) should not make `Zap ` and `Zap` two players that look
 * identical on the TV. Only the space character is touched: a tab or any other whitespace is
 * a bad character, not something to repair.
 */
export function normalizeHandle(raw: string): string {
  return raw.replace(/ {2,}/g, ' ').replace(/^ | $/g, '');
}

/**
 * The key two handles are compared by: the normalized handle in lower case. `Zap`, `ZAP`
 * and ` zap ` share the key `zap`. The server stores it in a unique column. It does not fold
 * look-alikes (`Z4P` is another player) or drop marks (`Z.A.P` is another player).
 */
export function handleKey(raw: string): string {
  return normalizeHandle(raw).toLowerCase();
}

/**
 * Checks a typed handle. Checks run in this order and the first failure is returned:
 * characters, length (after normalizing), then the vulgarity filter.
 */
export function checkHandle(raw: string): HandleCheck {
  if (!ALLOWED.test(raw)) return { ok: false, reason: 'bad-characters' };
  const handle = normalizeHandle(raw);
  if (handle.length < HANDLE_MIN) return { ok: false, reason: 'too-short' };
  if (handle.length > HANDLE_MAX) return { ok: false, reason: 'too-long' };
  if (isVulgar(handle)) return { ok: false, reason: 'not-allowed' };
  return { ok: true, handle, key: handle.toLowerCase() };
}
