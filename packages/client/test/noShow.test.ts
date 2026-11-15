import { describe, expect, it } from 'vitest';
import { FORFEIT_MARK, STILL_WAITING, THEY_ARE_HERE, arrivedWords, callWords, waitIsOver, waitingAgainWords } from '../src/noShow.ts';

const called = '2026-11-14T18:00:00.000Z';
const at = (minutes: number, seconds = 0) => Date.parse(called) + minutes * 60_000 + seconds * 1000;

describe('the wait for a missing player', () => {
  it('is over once the minutes have passed since the call', () => {
    expect(waitIsOver(called, 5, at(4, 59))).toBe(false);
    expect(waitIsOver(called, 5, at(5))).toBe(true);
    expect(waitIsOver(called, 10, at(9))).toBe(false);
    expect(waitIsOver(called, 10, at(12))).toBe(true);
  });

  it('is never over without a usable call time', () => {
    expect(waitIsOver(null, 5, at(60))).toBe(false);
    expect(waitIsOver('not a time', 5, at(60))).toBe(false);
  });

  it('is not over when the laptop clock is behind the server', () => {
    expect(waitIsOver(called, 3, at(-2))).toBe(false);
  });

  it('is never over for a call the host said the players are here for', () => {
    expect(waitIsOver(called, 5, at(30), true)).toBe(false);
    expect(waitIsOver(called, 5, at(30), false)).toBe(true);
    expect(waitIsOver(called, 5, at(30))).toBe(true);
  });
});

describe('the words', () => {
  it('calls every player of a match or a group to the station', () => {
    expect(callWords([{ handle: 'Zap' }, { handle: 'Kai' }], 2)).toBe('Zap and Kai, come to station 2!');
    expect(callWords([{ handle: 'Zap' }, { handle: 'Kai' }, { handle: 'Blaze' }], 1)).toBe('Zap, Kai, and Blaze, come to station 1!');
  });

  it('has the prompt and the mark DESIGN.md names', () => {
    expect(STILL_WAITING).toBe('Still waiting?');
    expect(THEY_ARE_HERE).toBe("They're here");
    expect(arrivedWords(2)).toBe("Station 2: they're here");
    expect(waitingAgainWords(2)).toBe('Station 2: waiting again');
    expect(FORFEIT_MARK).toBe('Forfeit');
  });
});
