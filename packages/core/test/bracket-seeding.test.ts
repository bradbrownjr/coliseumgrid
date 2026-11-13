// Bracket seeding (src/bracket-seeding.ts): the shuffle, the padding, and the late player.

import { describe, expect, it } from 'vitest';
import {
  BRACKET_PLAYERS_MAX,
  addLatePlayer,
  bracketPlayersMin,
  bracketSize,
  createSeededRandom,
  seedPlayers,
} from '../src/index.ts';

const ids = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe('bracketSize', () => {
  it.each([
    [2, 2],
    [3, 4],
    [4, 4],
    [5, 8],
    [8, 8],
    [9, 16],
    [17, 32],
    [32, 32],
  ])('elimination with %i players has %i slots', (players, slots) => {
    expect(bracketSize('single', players)).toBe(slots);
    expect(bracketSize('double', players)).toBe(slots);
  });

  it.each([
    [2, 2],
    [3, 4],
    [4, 4],
    [5, 6],
    [31, 32],
    [32, 32],
  ])('a round robin with %i players has %i slots', (players, slots) => {
    expect(bracketSize('round_robin', players)).toBe(slots);
  });
});

describe('bracketPlayersMin', () => {
  it('needs 3 for two lives and 2 for the rest', () => {
    expect(bracketPlayersMin('double')).toBe(3);
    expect(bracketPlayersMin('single')).toBe(2);
    expect(bracketPlayersMin('round_robin')).toBe(2);
  });
});

describe('seedPlayers', () => {
  it('gives the same order for the same seed (fixed results)', () => {
    expect(seedPlayers('single', ids(5), createSeededRandom(1))).toEqual([5, 3, 2, 1, 4, null, null, null]);
    expect(seedPlayers('round_robin', ids(5), createSeededRandom(1))).toEqual([5, 3, 2, 1, 4, null]);
    expect(seedPlayers('double', ids(8), createSeededRandom(42))).toEqual([3, 8, 2, 1, 7, 6, 4, 5]);
  });

  it('keeps every player once, with the nulls at the end', () => {
    for (const format of ['single', 'double', 'round_robin'] as const) {
      for (let n = bracketPlayersMin(format); n <= BRACKET_PLAYERS_MAX; n++) {
        const seeding = seedPlayers(format, ids(n), createSeededRandom(n));
        const players = seeding.filter((id) => id !== null);
        expect([...players].sort((a, b) => (a as number) - (b as number))).toEqual(ids(n));
        expect(seeding.slice(0, n)).toEqual(players);
        expect(seeding.slice(n).every((slot) => slot === null)).toBe(true);
        expect(seeding).toHaveLength(bracketSize(format, n));
      }
    }
  });

  it('never lets two byes meet: nulls fill at most half of an elimination bracket', () => {
    // The library pairs slot i with slot (size - 1 - i) in round 1 for inner_outer seeding, so
    // a null must face a player. With nulls at the end that holds while players >= size / 2.
    for (let n = 3; n <= BRACKET_PLAYERS_MAX; n++) {
      const size = bracketSize('single', n);
      expect(size - n).toBeLessThanOrEqual(size / 2);
    }
  });

  it('does not change the list it was given', () => {
    const given = ids(6);
    seedPlayers('single', given, createSeededRandom(3));
    expect(given).toEqual(ids(6));
  });

  it('shuffles: different seeds give more than one order', () => {
    const orders = new Set<string>();
    for (let seed = 0; seed < 20; seed++) orders.add(seedPlayers('single', ids(8), createSeededRandom(seed)).join());
    expect(orders.size).toBeGreaterThan(10);
  });

  it('turns down too few, too many, and repeated players', () => {
    expect(() => seedPlayers('single', ids(1), createSeededRandom(1))).toThrow(RangeError);
    expect(() => seedPlayers('double', ids(2), createSeededRandom(1))).toThrow(RangeError);
    expect(() => seedPlayers('single', ids(33), createSeededRandom(1))).toThrow(RangeError);
    expect(() => seedPlayers('single', [1, 2, 2], createSeededRandom(1))).toThrow(RangeError);
  });
});

describe('addLatePlayer', () => {
  it('takes the first empty slot', () => {
    expect(addLatePlayer([4, 2, 1, null, null], 9)).toEqual([4, 2, 1, 9, null]);
  });

  it('gives null when no slot is empty', () => {
    expect(addLatePlayer([4, 2, 1, 3], 9)).toBeNull();
  });

  it('leaves the list it was given alone and refuses a repeat', () => {
    const seeding = [1, 2, null, null];
    addLatePlayer(seeding, 5);
    expect(seeding).toEqual([1, 2, null, null]);
    expect(() => addLatePlayer(seeding, 2)).toThrow(RangeError);
  });
});
