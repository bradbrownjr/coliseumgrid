// The words for every answer the API can give (docs/PLAN.md, sections 3 and 4). The server
// sends codes, never sentences; this is where a code becomes text a 12-year-old can follow
// (docs/DOC-STYLE.md). A refusal says what to do next, not why in detail.

import { BRACKET_PLAYERS_MAX, HANDLE_MAX, HANDLE_MIN, PIN_LENGTH, type ApiErrorCode, type HandleRefusal } from '@coliseumgrid/core';

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
  'bracket-running': 'A bracket or groups are already running. Finish or delete them first.',
  'too-few-players': 'Pick more players to start.',
  'too-many-players': `Pick ${BRACKET_PLAYERS_MAX} players at most.`,
  'not-on-station': "That isn't on a station.",
  'undo-later-first': 'Undo the later results first.',
  'nothing-to-undo': 'There is nothing to undo.',
  'late-closed': "It's too late to add a player.",
  'already-in': 'That player is already in.',
  'in-bracket': 'That player is in the bracket or groups. Delete it to merge them.',
  'no-tie': 'Nobody is tied.',
  'no-bracket': "There's no bracket right now.",
  'no-heats': 'No groups are running.',
  failed: 'Something went wrong. Try again.',
};

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && value !== 'failed' && Object.hasOwn(ERROR_WORDS, value);
}

export function isHandleRefusal(value: unknown): value is HandleRefusal {
  return typeof value === 'string' && Object.hasOwn(HANDLE_REFUSAL_WORDS, value);
}

/** Words that replace `ERROR_WORDS` for one call, where a code means something else there. */
export type WordOverrides = Partial<Record<ClientErrorCode, string>>;

/**
 * Recording a group's result: its 404 `not-found` and 409 `not-on-station` mean the group is
 * no longer on a station, not a missing player (`ERROR_WORDS` is for the players routes).
 */
export const GROUP_RESULT_WORDS: WordOverrides = {
  'not-found': "That group isn't being played anymore.",
  'not-on-station': "That group isn't being played anymore.",
};

/**
 * The text for a failed call. A refusal with a known reason gets the reason's words. `overrides`
 * are the words of one call, tried first.
 */
export function failureWords(failure: Pick<Failure, 'error' | 'reason'>, overrides: WordOverrides = {}): string {
  if (failure.error === 'refused' && failure.reason) return HANDLE_REFUSAL_WORDS[failure.reason];
  return overrides[failure.error] ?? ERROR_WORDS[failure.error];
}

/**
 * The words for a password or code that was tried too often. The wait is the server's
 * 10-minute guess window, and nobody else can lift it, so "Ask the host" (the PIN words) would
 * send the host to the host.
 */
export const GUESS_LIMIT_WORDS = 'Too many tries. Wait 10 minutes, then try again.';

/** `failureWords` for the host sign-in and the join screen, where a limit means waiting. */
export function guessWords(failure: Pick<Failure, 'error' | 'reason'>): string {
  return failure.error === 'too-many-tries' ? GUESS_LIMIT_WORDS : failureWords(failure);
}
