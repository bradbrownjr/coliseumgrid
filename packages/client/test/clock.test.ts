import { afterEach, describe, expect, it } from 'vitest';
import { clockOffset, noteServerTime, resetServerClock, serverNow, withServerClock } from '../src/api/clock.ts';
import { waitIsOver } from '../src/noShow.ts';
import { elapsedText } from '../src/pages/host/bracketWords.ts';

afterEach(() => resetServerClock());

const calledAt = '2026-11-15T10:00:00.000Z';
const at = (seconds: number) => Date.parse(calledAt) + seconds * 1000;

describe('the offset to the server clock', () => {
  it('is the server time less the middle of the request', () => {
    // Sent at 1000 ms, answered at 1400 ms, so the server stamped it at about 1200 ms of the local clock.
    expect(clockOffset(new Date(11_200).toISOString(), 1000, 1400)).toBe(10_000);
    expect(clockOffset(new Date(1200).toISOString(), 1000, 1400)).toBe(0);
    expect(clockOffset(new Date(700).toISOString(), 1000, 1400)).toBe(-500);
  });

  it('is nothing when the server time is not a time', () => {
    expect(clockOffset('not a time', 1000, 1400)).toBeNull();
    expect(clockOffset('', 1000, 1400)).toBeNull();
  });

  it('moves server time ahead or behind the local clock, and keeps the last good one', () => {
    expect(serverNow(5000)).toBe(5000);
    noteServerTime(new Date(65_000).toISOString(), 5000, 5000);
    expect(serverNow(5000)).toBe(65_000);
    noteServerTime(new Date(1_000).toISOString(), 5000, 5000);
    expect(serverNow(5000)).toBe(1_000);
    noteServerTime('nope', 5000, 5000);
    expect(serverNow(5000)).toBe(1_000);
  });

  it('is learned from a call that answers with now, and not from a failed call', async () => {
    const sent = Date.now();
    await withServerClock(async () => ({ ok: true as const, data: { now: new Date(sent + 3_600_000).toISOString() } }));
    // An hour ahead, give or take the few milliseconds the call took.
    expect(Math.abs(serverNow() - (Date.now() + 3_600_000))).toBeLessThan(500);
    resetServerClock();
    await withServerClock(async () => ({ ok: false as const, error: 'failed' as const }));
    expect(serverNow(5000)).toBe(5000);
  });
});

describe('a station timed against a laptop clock that is wrong', () => {
  it('shows the wait as over and the timer right when the laptop is 5 minutes behind', () => {
    // The server called the station at `calledAt` and says it is now 6 minutes later.
    const laptop = at(6 * 60) - 5 * 60_000;
    // Alone, the laptop's clock says the station was called a minute ago.
    expect(waitIsOver(calledAt, 5, laptop)).toBe(false);
    expect(elapsedText(calledAt, laptop)).toBe('1:00');
    noteServerTime(new Date(at(6 * 60)).toISOString(), laptop, laptop);
    expect(waitIsOver(calledAt, 5, serverNow(laptop))).toBe(true);
    expect(elapsedText(calledAt, serverNow(laptop))).toBe('6:00');
  });

  it('keeps the wait from starting early when the laptop is 5 minutes ahead', () => {
    const laptop = at(2 * 60) + 5 * 60_000;
    expect(waitIsOver(calledAt, 5, laptop)).toBe(true);
    noteServerTime(new Date(at(2 * 60)).toISOString(), laptop, laptop);
    expect(waitIsOver(calledAt, 5, serverNow(laptop))).toBe(false);
    expect(elapsedText(calledAt, serverNow(laptop))).toBe('2:00');
    // And it counts on with the laptop's own seconds.
    expect(waitIsOver(calledAt, 5, serverNow(laptop + 3 * 60_000))).toBe(true);
  });
});
