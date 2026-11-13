import type { ApiErrorCode, HandleRefusal } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { ERROR_WORDS, GUESS_LIMIT_WORDS, HANDLE_REFUSAL_WORDS, failureWords, guessWords, isApiErrorCode, isHandleRefusal } from '../src/api/errors.ts';

// A Record over the union makes these lists fail to compile when core adds a code the
// screens have no words for.
const API_CODES: Record<ApiErrorCode, true> = {
  refused: true,
  taken: true,
  'bad-pin': true,
  'wrong-pin': true,
  'not-found': true,
  'too-many-tries': true,
  'bad-request': true,
  'server-error': true,
  'not-signed-in': true,
  forbidden: true,
  'wrong-password': true,
  'wrong-code': true,
  'not-paired': true,
  'bracket-running': true,
  'too-few-players': true,
  'too-many-players': true,
  'not-on-station': true,
  'undo-later-first': true,
  'nothing-to-undo': true,
  'late-closed': true,
  'already-in': true,
  'in-bracket': true,
  'no-tie': true,
  'no-bracket': true,
  'no-heats': true,
};
const REFUSALS: Record<HandleRefusal, true> = {
  'too-short': true,
  'too-long': true,
  'bad-characters': true,
  'not-allowed': true,
};

describe('error words', () => {
  it.each(Object.keys(API_CODES) as ApiErrorCode[])('has words for the API code %s', (code) => {
    expect(failureWords({ error: code }).length).toBeGreaterThan(0);
    expect(isApiErrorCode(code)).toBe(true);
  });

  it.each(Object.keys(REFUSALS) as HandleRefusal[])('has words for the refusal %s', (reason) => {
    expect(failureWords({ error: 'refused', reason }).length).toBeGreaterThan(0);
    expect(isHandleRefusal(reason)).toBe(true);
  });

  it('has words for a call that got no usable answer', () => {
    expect(failureWords({ error: 'failed' })).toBe('Something went wrong. Try again.');
  });

  it('has no words that the API does not send', () => {
    expect(Object.keys(ERROR_WORDS).sort()).toEqual([...Object.keys(API_CODES), 'failed'].sort());
    expect(Object.keys(HANDLE_REFUSAL_WORDS).sort()).toEqual(Object.keys(REFUSALS).sort());
  });

  it('says what to do next for each refusal', () => {
    expect(failureWords({ error: 'refused', reason: 'not-allowed' })).toBe('Pick another handle');
    expect(failureWords({ error: 'refused', reason: 'too-short' })).toBe('Use at least 2 letters or numbers');
    expect(failureWords({ error: 'refused', reason: 'too-long' })).toBe('Use 16 letters or numbers at most');
    expect(failureWords({ error: 'refused', reason: 'bad-characters' })).toBe('Use letters, numbers, spaces, . - or _');
  });

  it('uses the sign-up words for the other codes', () => {
    expect(failureWords({ error: 'taken' })).toBe('That handle is taken.');
    expect(failureWords({ error: 'wrong-pin' })).toBe("That PIN doesn't match. Try again.");
    expect(failureWords({ error: 'too-many-tries' })).toBe('Too many tries. Ask the host.');
  });

  it('falls back to a plain line for a refusal with no reason', () => {
    expect(failureWords({ error: 'refused' })).toBe('Pick another handle');
  });

  it('keeps the writing rules for screen text', () => {
    for (const words of [...Object.values(ERROR_WORDS), ...Object.values(HANDLE_REFUSAL_WORDS)]) {
      expect(words).not.toMatch(/[\u2014]|\p{Extended_Pictographic}/u);
    }
  });

  it('does not treat other strings as codes', () => {
    expect(isApiErrorCode('failed')).toBe(false);
    expect(isApiErrorCode('toString')).toBe(false);
    expect(isApiErrorCode(7)).toBe(false);
    expect(isHandleRefusal('toString')).toBe(false);
  });
});

describe('words for the bracket codes', () => {
  it('says what to do next', () => {
    expect(failureWords({ error: 'undo-later-first' })).toBe('Undo the later results first.');
    expect(failureWords({ error: 'too-many-players' })).toBe('Pick 32 players at most.');
    expect(failureWords({ error: 'late-closed' })).toBe("It's too late to add a player.");
  });
});

describe('words for the heats codes', () => {
  it('calls a heat a group', () => {
    expect(failureWords({ error: 'no-heats' })).toBe('No groups are running.');
  });
});

describe('words for guessed passwords and codes', () => {
  it('tells the host to wait, not to ask the host', () => {
    expect(guessWords({ error: 'too-many-tries' })).toBe(GUESS_LIMIT_WORDS);
    expect(GUESS_LIMIT_WORDS).not.toMatch(/ask/i);
  });

  it('uses the shared words for everything else', () => {
    expect(guessWords({ error: 'wrong-password' })).toBe("That password doesn't match. Try again.");
    expect(guessWords({ error: 'wrong-code' })).toBe("That code doesn't work. Ask the host for a new one.");
    expect(guessWords({ error: 'forbidden' })).toBe('Only the host laptop can do that.');
    expect(guessWords({ error: 'failed' })).toBe('Something went wrong. Try again.');
  });

  it('keeps the writing rules', () => {
    expect(GUESS_LIMIT_WORDS).not.toMatch(/[\u2014]|\p{Extended_Pictographic}/u);
  });
});
