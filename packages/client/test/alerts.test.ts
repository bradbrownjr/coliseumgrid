import type { FollowedPlayer } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import {
  CALL_BEEPS,
  FLASH_SECONDS,
  decideAlerts,
  mergeAlerts,
  pageTitle,
  rememberStatuses,
  stillCalled,
  stillNext,
  type CalledAlert,
} from '../src/pages/phone/alerts.ts';

const zap = { id: 3, handle: 'Zap' };
const kai = { id: 2, handle: 'Kai' };

const followed = (player: FollowedPlayer['player'], status: FollowedPlayer['status'], extra: Partial<FollowedPlayer> = {}): FollowedPlayer => ({
  player,
  status,
  away: null,
  station: null,
  matchId: null,
  others: [],
  place: null,
  ...extra,
});

const called = (matchId: number | null = 7): FollowedPlayer => followed(zap, 'now', { station: 2, matchId, others: [kai] });

describe('deciding alerts between two answers', () => {
  it('raises nothing on the first load, whatever the status', () => {
    const decision = decideAlerts(null, [called()]);
    expect(decision.called).toEqual([]);
    expect(decision.next).toEqual([]);
    expect(decision.memory.get(3)).toEqual({ status: 'now', matchId: 7 });
  });

  it('calls a player who becomes now, with the station and the others', () => {
    const before = rememberStatuses([followed(zap, 'next', { matchId: 7 })]);
    expect(decideAlerts(before, [called()]).called).toEqual([{ playerId: 3, handle: 'Zap', station: 2, matchId: 7, others: ['Kai'] }]);
  });

  it('calls again for a different match on the same station, not for the same one', () => {
    const before = rememberStatuses([called(7)]);
    expect(decideAlerts(before, [called(7)]).called).toEqual([]);
    expect(decideAlerts(before, [called(8)]).called).toHaveLength(1);
  });

  it('raises a next banner when a player becomes next, once', () => {
    const before = rememberStatuses([followed(zap, 'two-away', { matchId: 7 })]);
    const now = [followed(zap, 'next', { matchId: 7 })];
    expect(decideAlerts(before, now).next).toEqual([{ playerId: 3, handle: 'Zap' }]);
    expect(decideAlerts(rememberStatuses(now), now).next).toEqual([]);
  });

  it('raises nothing for two away, or for a player followed since the last answer', () => {
    const before = rememberStatuses([followed(zap, 'later', { matchId: 7 })]);
    expect(decideAlerts(before, [followed(zap, 'two-away', { matchId: 7 })]).called).toEqual([]);
    expect(decideAlerts(before, [followed(zap, 'two-away'), called()].map((f, i) => (i === 1 ? { ...f, player: kai } : f))).called).toEqual([]);
  });

  it('alerts each player of a parent separately', () => {
    const before = rememberStatuses([followed(zap, 'next', { matchId: 7 }), followed(kai, 'later', { matchId: 8 })]);
    const decision = decideAlerts(before, [called(), followed(kai, 'next', { matchId: 8 })]);
    expect(decision.called.map((c) => c.handle)).toEqual(['Zap']);
    expect(decision.next.map((n) => n.handle)).toEqual(['Kai']);
  });
});

describe('alerts that still apply', () => {
  const call: CalledAlert = { playerId: 3, handle: 'Zap', station: 2, matchId: 7, others: [] };

  it('keeps a call while the player is still on that match', () => {
    expect(stillCalled([call], [called(7)])).toEqual([call]);
  });

  it('drops a call once the result is recorded, or the player is on another match', () => {
    expect(stillCalled([call], [followed(zap, 'later')])).toEqual([]);
    expect(stillCalled([call], [called(8)])).toEqual([]);
    expect(stillCalled([call], [])).toEqual([]);
  });

  it('keeps a next banner only while the player is first in Up next', () => {
    const banner = { playerId: 3, handle: 'Zap' };
    expect(stillNext([banner], [followed(zap, 'next')])).toEqual([banner]);
    expect(stillNext([banner], [followed(zap, 'now')])).toEqual([]);
  });

  it('merges one alert per player, the newer one winning', () => {
    const newer = { ...call, station: 1, matchId: 9 };
    expect(mergeAlerts([call], [newer])).toEqual([newer]);
    expect(mergeAlerts([call], [{ ...call, playerId: 2 }])).toHaveLength(2);
  });
});

describe('the page title', () => {
  const call: CalledAlert = { playerId: 3, handle: 'Zap', station: 2, matchId: 7, others: [] };
  const soon = { playerId: 3, handle: 'Zap' };

  it('flips between the call and the page name', () => {
    expect(pageTitle({ called: [call], next: [], flip: false, base: 'Race Night' })).toBe('Zap: go to station 2');
    expect(pageTitle({ called: [call], next: [], flip: true, base: 'Race Night' })).toBe('Race Night');
  });

  it('holds steady for a next banner, and goes back to the page name', () => {
    expect(pageTitle({ called: [], next: [soon], flip: true, base: 'Race Night' })).toBe("Zap, you're next!");
    expect(pageTitle({ called: [], next: [], flip: false, base: 'Race Night' })).toBe('Race Night');
  });
});

describe('the call sound and flash', () => {
  it('is three beeps that do not overlap', () => {
    expect(CALL_BEEPS).toHaveLength(3);
    for (const [i, beep] of CALL_BEEPS.entries()) {
      const after = CALL_BEEPS[i + 1];
      if (after) expect(beep.at + beep.length).toBeLessThan(after.at);
    }
  });

  it('flashes at most three times a second (WCAG 2.3.1)', () => {
    expect(1 / FLASH_SECONDS).toBeLessThanOrEqual(3);
  });
});
