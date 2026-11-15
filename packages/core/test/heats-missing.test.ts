// Heats with players who didn't come (docs/PLAN.md, "Waiting for a missing player").

import { describe, expect, it } from 'vitest';
import { isFinishOrder, isHeatResult, placeMissing, rankByPoints, scoreHeats } from '../src/index.ts';

describe('isHeatResult', () => {
  const players = [1, 2, 3, 4];

  it('agrees with isFinishOrder when nobody is missing', () => {
    const cases: number[][] = [[1, 2, 3, 4], [4, 3, 2, 1], [1, 2, 3], [1, 2, 3, 3], [1, 2, 3, 9], [], [1, 1, 1, 1]];
    for (const order of cases) expect(isHeatResult(players, order, [])).toBe(isFinishOrder(players, order) && order.length > 0);
  });

  it('accepts the players who played and the missing ones, each player once', () => {
    expect(isHeatResult(players, [2, 1], [3, 4])).toBe(true);
    expect(isHeatResult(players, [2], [4, 3, 1])).toBe(true);
    expect(isHeatResult(players, [4, 3, 2], [1])).toBe(true);
  });

  it('refuses a heat where nobody came', () => {
    expect(isHeatResult(players, [], [1, 2, 3, 4])).toBe(false);
  });

  it('refuses a player in both lists, a player left out, a stranger, and a repeat', () => {
    expect(isHeatResult(players, [1, 2], [2, 3, 4])).toBe(false);
    expect(isHeatResult(players, [1, 2], [3])).toBe(false);
    expect(isHeatResult(players, [1, 2], [3, 9])).toBe(false);
    expect(isHeatResult(players, [1, 2], [3, 4, 4])).toBe(false);
    expect(isHeatResult(players, [1, 1], [3, 4])).toBe(false);
  });
});

describe('scoreHeats with missing players', () => {
  const points = [4, 3, 2, 1];
  const seeding = [1, 2, 3, 4, 5, 6, 7, 8];

  it('scores plain finishing orders exactly as before', () => {
    expect(scoreHeats(seeding, [[1, 2, 3, 4], [8, 7, 6, 5]], points)).toEqual(
      scoreHeats(seeding, [{ order: [1, 2, 3, 4], missing: [] }, { order: [8, 7, 6, 5], missing: [] }], points),
    );
  });

  it('gives a missing player 0 points and counts the heat as played for them', () => {
    const scores = scoreHeats(seeding, [{ order: [2, 1], missing: [3, 4] }], points);
    const of = (id: number) => scores.find((s) => s.player === id);
    expect(of(2)).toMatchObject({ points: 4, heatsPlayed: 1 });
    expect(of(1)).toMatchObject({ points: 3, heatsPlayed: 1 });
    expect(of(3)).toMatchObject({ points: 0, heatsPlayed: 1 });
    expect(of(4)).toMatchObject({ points: 0, heatsPlayed: 1 });
    expect(of(5)).toMatchObject({ points: 0, heatsPlayed: 0 });
  });

  it('places the players who came by their order, as if the heat were smaller', () => {
    // A heat of 4 where only 2 came: 1st and 2nd score 4 and 3, not 3rd's and 4th's.
    const scores = scoreHeats([1, 2, 3, 4], [{ order: [4, 3], missing: [1, 2] }], points);
    expect(scores.map((s) => [s.player, s.points])).toEqual([[4, 4], [3, 3], [1, 0], [2, 0]]);
  });

  it('mixes plain orders and orders with missing players', () => {
    const scores = scoreHeats(seeding, [[1, 2, 3, 4], { order: [5, 6], missing: [7, 8] }], points);
    expect(scores.filter((s) => s.heatsPlayed === 1)).toHaveLength(8);
    expect(scores.find((s) => s.player === 5)?.points).toBe(4);
    expect(scores.find((s) => s.player === 8)?.points).toBe(0);
  });

  it('keeps level players in seeding order, missing ones included', () => {
    const scores = scoreHeats(seeding, [{ order: [8], missing: [1, 2, 3, 4, 5, 6, 7] }], points);
    expect(scores.map((s) => s.player)).toEqual([8, 1, 2, 3, 4, 5, 6, 7]);
    expect(rankByPoints(scores).map((g) => g.players)).toEqual([[8], [1, 2, 3, 4, 5, 6, 7]]);
  });

  it('refuses a missing player who is not in the seeding', () => {
    expect(() => scoreHeats(seeding, [{ order: [1, 2], missing: [99] }], points)).toThrow(RangeError);
  });
});

describe('placeMissing', () => {
  it('puts the missing players after those who played, in qualifying order', () => {
    // Qualifying order 7, 3, 9, 1, 5: the final is 3, 9, 1, 5, and 9 and 5 didn't come.
    expect(placeMissing([3, 1], [5, 9], [7, 3, 9, 1, 5])).toEqual([3, 1, 9, 5]);
    expect(placeMissing([3, 1], [9, 5], [7, 3, 9, 1, 5])).toEqual([3, 1, 9, 5]);
  });

  it('gives the order back when nobody is missing, and does not change its inputs', () => {
    const order = [4, 2];
    const missing = [3, 1];
    expect(placeMissing(order, [], [1, 2, 3, 4])).toEqual([4, 2]);
    expect(placeMissing(order, missing, [1, 2, 3, 4])).toEqual([4, 2, 1, 3]);
    expect(missing).toEqual([3, 1]);
    expect(order).toEqual([4, 2]);
  });

  it('keeps places 1 to 3 unique: the full order is a permutation of the heat', () => {
    const full = placeMissing([2], [1, 3, 4], [1, 2, 3, 4]);
    expect([...full].sort()).toEqual([1, 2, 3, 4]);
    expect(isFinishOrder([1, 2, 3, 4], full)).toBe(true);
  });

  it('refuses a missing player who is not in the ranking', () => {
    expect(() => placeMissing([1], [9], [1, 2])).toThrow(RangeError);
  });
});
