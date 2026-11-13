// The words for every answer the API can give (docs/PLAN.md, sections 3 and 4). The server
// sends codes, never sentences; this is where a code becomes text a 12-year-old can follow
// (docs/DOC-STYLE.md). A refusal says what to do next, not why in detail.

import { HANDLE_MAX, HANDLE_MIN, PIN_LENGTH, type ApiErrorCode, type HandleRefusal } from '@coliseumgrid/core';

/** The API's codes, plus one for a request that never got a usable answer. */
export type ClientErrorCode = ApiErrorCode | 'failed';

/** What a screen switches on when a call did not work. */
export interface Failure {
  ok: false;
  error: ClientErrorCode;
  /** Only with `error: 'refused'`. */
  reason?: HandleRefusal;
}

export const HANDLE_REFUSAL_WORDS: Record<HandleRefusal, string> = {
  'too-short': `Use at least ${HANDLE_MIN} letters or numbers`,
  'too-long': `Use ${HANDLE_MAX} letters or numbers at most`,
  'bad-characters': 'Use letters, numbers, spaces, . - or _',
  'not-allowed': 'Pick another handle',
};

export const ERROR_WORDS: Record<ClientErrorCode, string> = {
  // Used only when the server sends a refusal with no reason we know.
  refused: 'Pick another handle',
  taken: 'That handle is taken.',
  'bad-pin': `A PIN is ${PIN_LENGTH} numbers.`,
  'wrong-pin': "That PIN doesn't match. Try again.",
  'not-found': "That player isn't there anymore.",
  'too-many-tries': 'Too many tries. Ask the host.',
  'bad-request': 'Something went wrong. Try again.',
  'server-error': 'Something went wrong. Try again.',
  'not-signed-in': 'Sign in as the host first.',
  forbidden: 'Only the host laptop can do that.',
  'wrong-password': "That password doesn't match. Try again.",
  'wrong-code': "That code doesn't work. Ask the host for a new one.",
  'not-paired': 'This screen needs a code from the host.',
  failed: 'Something went wrong. Try again.',
};

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && value !== 'failed' && Object.hasOwn(ERROR_WORDS, value);
}

export function isHandleRefusal(value: unknown): value is HandleRefusal {
  return typeof value === 'string' && Object.hasOwn(HANDLE_REFUSAL_WORDS, value);
}

/** The text for a failed call. A refusal with a known reason gets the reason's words. */
export function failureWords(failure: Pick<Failure, 'error' | 'reason'>): string {
  if (failure.error === 'refused' && failure.reason) return HANDLE_REFUSAL_WORDS[failure.reason];
  return ERROR_WORDS[failure.error];
}
