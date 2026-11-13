// Heats (src/heats.ts): group sizes, round 1 and regrouping, points, the cut for the final and
// its tie-breaks, the final's places, and where a late player goes.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POINTS,
  FINAL_SIZE,
  HEAT_PLAYERS_MAX,
  HEAT_PLAYERS_MIN,
  createSeededRandom,
  cutIntoHeats,
  finalPlaces,
  hasQualifying,
  isFinishOrder,
  isPointsTable,
  lateJoinHeat,
  rankByPoints,
  regroup,
  scoreHeats,
  seedHeats,
  settleCut,
  shuffle,
  splitHeats,
  type RandomSource,
  type TieBreakHeat,
} from '../src/index.ts';

const ids = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);
const COUNTS = ids(HEAT_PLAYERS_MAX).filter((n) => n >= HEAT_PLAYERS_MIN);

describe('splitHeats', () => {
  it.each([
    [2, [2]],
    [4, [4]],
    [5, [3, 2]],
    [6, [3, 3]],
    [7, [4, 3]],
    [9, [3, 3, 3]],
    [10, [4, 3, 3]],
    [13, [4, 3, 3, 3]],
    [32, [4, 4, 4, 4, 4, 4, 4, 4]],
  ])('splits %i players into %j', (n, sizes) => {
    expect(splitHeats(n)).toEqual(sizes);
  });

  it.each(COUNTS)('%i players: ceil(n/4) heats of 2 to 4, as even as possible, larger first', (n) => {
    const sizes = splitHeats(n);
    expect(sizes.length).toBe(Math.ceil(n / 4));
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(4);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
    if (n !== 2 && n !== 5) expect(Math.min(...sizes)).toBeGreaterThanOrEqual(3);
  });

  it('refuses fewer than 2 players', () => {
    expect(() => splitHeats(1)).toThrow(RangeError);
    expect(() => splitHeats(2.5)).toThrow(RangeError);
  });
});

describe('seedHeats and cutIntoHeats', () => {
  it('shuffles with the caller\'s source, the same way every time for a seed', () => {
    const a = seedHeats(ids(12), createSeededRandom(7));
    expect(seedHeats(ids(12), createSeededRandom(7))).toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual(ids(12));
    expect(a).toEqual(shuffle(ids(12), createSeededRandom(7)));
  });

  it('refuses too few, too many, or a repeat', () => {
    const random = createSeededRandom(1);
    expect(() => seedHeats([1], random)).toThrow(RangeError);
    expect(() => seedHeats(ids(33), random)).toThrow(RangeError);
    expect(() => seedHeats([1, 2, 2], random)).toThrow(RangeError);
  });

  it('cuts the seeding into heats in order', () => {
    expect(cutIntoHeats([7, 3, 9, 1, 5, 2, 8])).toEqual([[7, 3, 9, 1], [5, 2, 8]]);
    expect(() => cutIntoHeats([1, 1])).toThrow(RangeError);
  });

  it('plays qualifying rounds only above 4 players', () => {
    expect(hasQualifying(4)).toBe(false);
    expect(hasQualifying(5)).toBe(true);
  });
});

describe('isPointsTable', () => {
  it.each([[[4, 3, 2, 1]], [[10, 6, 3, 0]], [[1, 1, 1, 1]], [[20, 0, 0, 0]]])('accepts %j', (points) => {
    expect(isPointsTable(points)).toBe(true);
  });

  it.each([[[4, 3, 2]], [[4, 3, 2, 1, 0]], [[0, 0, 0, 0]], [[3, 4, 2, 1]], [[4, 3, 2, -1]], [[21, 3, 2, 1]], [[4, 3, 2, 1.5]], [['4', 3, 2, 1]], ['4321'], [null]])(
    'refuses %j',
    (points) => {
      expect(isPointsTable(points)).toBe(false);
    },
  );

  it('takes the default', () => {
    expect(isPointsTable([...DEFAULT_POINTS])).toBe(true);
  });
});

describe('isFinishOrder', () => {
  it('needs every player of the heat once', () => {
    expect(isFinishOrder([1, 2, 3], [3, 1, 2])).toBe(true);
    expect(isFinishOrder([1, 2, 3], [3, 1])).toBe(false);
    expect(isFinishOrder([1, 2, 3], [3, 1, 1])).toBe(false);
    expect(isFinishOrder([1, 2, 3], [3, 1, 4])).toBe(false);
  });
});

describe('scoreHeats, rankByPoints, regroup', () => {
  // Seeding 1..8, round 1 heats [1,2,3,4] and [5,6,7,8].
  const seeding = ids(8);
  const finishes = [
    [4, 3, 2, 1],
    [5, 6, 7, 8],
  ];

  it('scores by place from the table; level players stay in seeding order', () => {
    const scores = scoreHeats(seeding, finishes, DEFAULT_POINTS);
    expect(scores.map((s) => [s.player, s.points])).toEqual([
      [4, 4], [5, 4], [3, 3], [6, 3], [2, 2], [7, 2], [1, 1], [8, 1],
    ]);
    expect(scores.every((s) => s.heatsPlayed === 1)).toBe(true);
  });

  it('scores a heat of 3 and of 2 by its first places', () => {
    const scores = scoreHeats([1, 2, 3, 4, 5], [[3, 1, 2], [5, 4]], DEFAULT_POINTS);
    expect(Object.fromEntries(scores.map((s) => [s.player, s.points]))).toEqual({ 1: 3, 2: 2, 3: 4, 4: 3, 5: 4 });
  });

  it('groups level players into shared places', () => {
    expect(rankByPoints(scoreHeats(seeding, finishes, DEFAULT_POINTS))).toEqual([
      { place: 1, players: [4, 5] },
      { place: 3, players: [3, 6] },
      { place: 5, players: [2, 7] },
      { place: 7, players: [1, 8] },
    ]);
  });

  it('regroups by points so far, with no new randomness', () => {
    expect(regroup(scoreHeats(seeding, finishes, DEFAULT_POINTS))).toEqual([[4, 5, 3, 6], [2, 7, 1, 8]]);
  });

  it('puts the larger heats at the top', () => {
    const scores = scoreHeats(ids(7), [[1, 2, 3, 4], [5, 6, 7]], DEFAULT_POINTS);
    expect(regroup(scores).map((h) => h.length)).toEqual([4, 3]);
  });

  it('refuses a player who is not in the seeding', () => {
    expect(() => scoreHeats([1, 2], [[1, 3]], DEFAULT_POINTS)).toThrow(RangeError);
  });
});

describe('settleCut', () => {
  it('sends the top 4 when nobody is level across the cut', () => {
    const ranking = [{ place: 1, players: [1, 2] }, { place: 3, players: [3, 4] }, { place: 5, players: [5, 6] }];
    expect(settleCut(ranking, [])).toEqual({ ranking, finalists: [1, 2, 3, 4], tie: null });
  });

  it('sends everyone when there are 4 or fewer', () => {
    expect(settleCut([{ place: 1, players: [1, 2, 3] }], []).finalists).toEqual([1, 2, 3]);
  });

  it('asks for one tie-break race among 2 players level across the cut, and settles it', () => {
    const ranking = [{ place: 1, players: [1, 2, 3] }, { place: 4, players: [4, 5] }, { place: 6, players: [6] }];
    const asked = settleCut(ranking, []);
    expect(asked.finalists).toBeNull();
    expect(asked.tie).toEqual({ place: 4, players: [4, 5], pass: 1, heats: [[4, 5]], started: false });

    const made: TieBreakHeat[] = [{ pass: 1, players: [4, 5], order: null }];
    expect(settleCut(ranking, made).tie).toMatchObject({ started: true, heats: [[4, 5]] });

    const settled = settleCut(ranking, [{ pass: 1, players: [4, 5], order: [5, 4] }]);
    expect(settled.tie).toBeNull();
    expect(settled.finalists).toEqual([1, 2, 3, 5]);
    expect(settled.ranking).toEqual([
      { place: 1, players: [1, 2, 3] },
      { place: 4, players: [5] },
      { place: 5, players: [4] },
      { place: 6, players: [6] },
    ]);
  });

  it('settles 4 tied for 2 spots in one race', () => {
    const ranking = [{ place: 1, players: [1, 2] }, { place: 3, players: [3, 4, 5, 6] }];
    const settled = settleCut(ranking, [{ pass: 1, players: [3, 4, 5, 6], order: [6, 3, 5, 4] }]);
    expect(settled.finalists).toEqual([1, 2, 6, 3]);
  });

  it('splits 6 tied into two races, and plays again for whoever is still level at the cut', () => {
    const ranking = [{ place: 1, players: [1] }, { place: 2, players: [2, 3, 4, 5, 6, 7] }];
    const first = settleCut(ranking, []);
    expect(first.tie?.heats).toEqual([[2, 3, 4], [5, 6, 7]]);
    // 1st places 4 and 7 take places 2 and 3; 2nd places 2 and 5 are level across the cut at 4.
    const pass1: TieBreakHeat[] = [
      { pass: 1, players: [2, 3, 4], order: [4, 2, 3] },
      { pass: 1, players: [5, 6, 7], order: [7, 5, 6] },
    ];
    const second = settleCut(ranking, pass1);
    expect(second.tie).toEqual({ place: 4, players: [2, 5], pass: 2, heats: [[2, 5]], started: false });
    const done = settleCut(ranking, [...pass1, { pass: 2, players: [2, 5], order: [5, 2] }]);
    expect(done.finalists).toEqual([1, 4, 7, 5]);
    expect(done.ranking).toEqual([
      { place: 1, players: [1] },
      { place: 2, players: [4, 7] },
      { place: 4, players: [5] },
      { place: 5, players: [2] },
      { place: 6, players: [3, 6] },
    ]);
  });

  it('refuses tie-break heats that do not hold the tied players, or that no tie needs', () => {
    const ranking = [{ place: 1, players: [1, 2, 3] }, { place: 4, players: [4, 5] }];
    expect(() => settleCut(ranking, [{ pass: 1, players: [3, 4], order: null }])).toThrow(RangeError);
    const clear = [{ place: 1, players: [1, 2, 3, 4] }, { place: 5, players: [5] }];
    expect(() => settleCut(clear, [{ pass: 1, players: [4, 5], order: [4, 5] }])).toThrow(RangeError);
  });
});

describe('finalPlaces', () => {
  it('takes places 1 to 4 from the final and keeps the rest', () => {
    const ranking = [{ place: 1, players: [1, 2] }, { place: 3, players: [3] }, { place: 4, players: [4] }, { place: 5, players: [5, 6] }];
    expect(finalPlaces(ranking, [3, 1, 4, 2])).toEqual([
      { place: 1, players: [3] },
      { place: 2, players: [1] },
      { place: 3, players: [4] },
      { place: 4, players: [2] },
      { place: 5, players: [5, 6] },
    ]);
    expect(finalPlaces(ranking, null)).toEqual(ranking);
  });
});

describe('lateJoinHeat', () => {
  it('picks the smallest waiting heat with room, lowest number on a tie', () => {
    const heats = [
      { id: 101, number: 1, size: 4, waiting: true },
      { id: 102, number: 2, size: 3, waiting: false },
      { id: 103, number: 3, size: 3, waiting: true },
      { id: 104, number: 4, size: 3, waiting: true },
    ];
    expect(lateJoinHeat(heats)).toBe(103);
    expect(lateJoinHeat([...heats, { id: 105, number: 5, size: 2, waiting: true }])).toBe(105);
  });

  it('is null when no waiting heat has room', () => {
    expect(lateJoinHeat([{ id: 101, number: 1, size: 4, waiting: true }, { id: 102, number: 2, size: 3, waiting: false }])).toBeNull();
    expect(lateJoinHeat([])).toBeNull();
  });
});

// A whole event at every count, played with these functions the way the engine will: round 1
// from the seeding, later rounds regrouped by points, tie-break passes until the cut is
// settled, then the final.
function play(n: number, rounds: number, random: RandomSource, points: readonly number[] = DEFAULT_POINTS) {
  const seeding = seedHeats(ids(n), random);
  const finishes: number[][] = [];
  const heatsPerPlayer = new Map(seeding.map((id) => [id, 0]));
  const qualifying = hasQualifying(n) ? rounds : 0;
  for (let round = 1; round <= qualifying; round++) {
    const heats = round === 1 ? cutIntoHeats(seeding) : regroup(scoreHeats(seeding, finishes, points));
    expect(heats.flat().sort((a, b) => a - b)).toEqual(ids(n));
    for (const heat of heats) {
      expect(heat.length).toBeGreaterThanOrEqual(2);
      expect(heat.length).toBeLessThanOrEqual(4);
      for (const id of heat) heatsPerPlayer.set(id, (heatsPerPlayer.get(id) ?? 0) + 1);
      finishes.push(shuffle(heat, random));
    }
  }
  const ranking = rankByPoints(scoreHeats(seeding, finishes, points));
  const tieBreaks: TieBreakHeat[] = [];
  let cut = settleCut(ranking, tieBreaks);
  let passes = 0;
  while (cut.tie) {
    passes += 1;
    expect(passes).toBeLessThan(10);
    for (const heat of cut.tie.heats) tieBreaks.push({ pass: cut.tie.pass, players: heat, order: shuffle(heat, random) });
    cut = settleCut(ranking, tieBreaks);
  }
  const finalists = cut.finalists as number[];
  const places = finalPlaces(cut.ranking, shuffle(finalists, random));
  return { finalists, places, heatsPerPlayer, passes };
}

describe('a whole event at every count from 2 to 32', () => {
  it.each(COUNTS)('%i players reach a final with places 1 to 3 unique, everyone playing the same number of groups', (n) => {
    let tieBreakPasses = 0;
    for (let rounds = 1; rounds <= 3; rounds++) {
      for (let seed = 1; seed <= 20; seed++) {
        const { finalists, places, heatsPerPlayer, passes } = play(n, rounds, createSeededRandom(n * 1000 + rounds * 100 + seed));
        tieBreakPasses += passes;
        expect(finalists.length).toBe(Math.min(n, FINAL_SIZE));
        const played = new Set(heatsPerPlayer.values());
        expect([...played]).toEqual([hasQualifying(n) ? rounds : 0]);
        expect(places.flatMap((g) => g.players).sort((a, b) => a - b)).toEqual(ids(n));
        for (const place of [1, 2, 3].filter((p) => p <= n)) {
          expect(places.filter((g) => g.place === place).map((g) => g.players.length)).toEqual([1]);
        }
      }
    }
    if (n > FINAL_SIZE) expect(tieBreakPasses).toBeGreaterThan(0);
  });
});
