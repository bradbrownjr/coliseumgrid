// The time estimate (src/estimate.ts, docs/PLAN.md, "Time estimate"): match counts, waves,
// minutes, the display rounding, the too-long check, and the fixes.

import { describe, expect, it } from 'vitest';
import {
  EXPECTED_GAMES,
  FIXES_MAX,
  STATIONS_MAX,
  canEstimate,
  displayMinutes,
  estimatePlan,
  isEventPlan,
  isTooLong,
  planDefaults,
  suggestFixes,
  type EventPlan,
  type Estimate,
  type PlanFormat,
} from '../src/index.ts';

const FORMATS: readonly PlanFormat[] = ['single', 'double', 'round_robin', 'heats'];
const COUNTS = Array.from({ length: 31 }, (_, i) => i + 2);
const STATION_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];

const plan = (patch: Partial<EventPlan> = {}): EventPlan => ({ ...planDefaults('fighting'), ...patch });
const must = (p: EventPlan, n: number): Estimate => {
  const e = estimatePlan(p, n);
  if (!e) throw new Error(`no estimate for ${p.format} with ${n} players`);
  return e;
};
const minPlayers = (format: PlanFormat): number => (format === 'double' ? 3 : 2);
const log2Ceil = (n: number): number => Math.ceil(Math.log2(n));

describe('canEstimate', () => {
  it('takes 2 to 32 players, and 3 to 32 for two lives', () => {
    for (const format of FORMATS) {
      expect(canEstimate(format, minPlayers(format) - 1)).toBe(false);
      expect(canEstimate(format, minPlayers(format))).toBe(true);
      expect(canEstimate(format, 32)).toBe(true);
      expect(canEstimate(format, 33)).toBe(false);
      expect(canEstimate(format, 0)).toBe(false);
      expect(canEstimate(format, 4.5)).toBe(false);
    }
    expect(canEstimate('double', 2)).toBe(false);
  });

  it('gives no estimate for a count the format cannot start with', () => {
    expect(estimatePlan(plan({ format: 'double' }), 2)).toBeNull();
    expect(estimatePlan(plan({ format: 'heats' }), 1)).toBeNull();
    expect(estimatePlan(plan({ format: 'single' }), 33)).toBeNull();
  });
});

describe('match counts, 2 to 32 players', () => {
  it.each(COUNTS)('%i players, one life: n - 1, plus the 3rd-place match from 4 players', (n) => {
    const m = must(plan({ format: 'single' }), n).matches;
    expect(m).toEqual({ low: n - 1 + (n >= 4 ? 1 : 0), high: n - 1 + (n >= 4 ? 1 : 0) });
  });

  it.each(COUNTS.filter((n) => n >= 3))('%i players, two lives: 2n - 2 to 2n - 1', (n) => {
    expect(must(plan({ format: 'double' }), n).matches).toEqual({ low: 2 * n - 2, high: 2 * n - 1 });
  });

  it.each(COUNTS)('%i players, everyone plays everyone: n(n - 1) / 2, up to 3 more from 3 players', (n) => {
    const all = (n * (n - 1)) / 2;
    expect(must(plan({ format: 'round_robin' }), n).matches).toEqual({ low: all, high: all + (n >= 3 ? 3 : 0) });
  });

  it.each(COUNTS)('%i players, groups: the final alone to 4, else rounds x groups + the final, plus tie-break groups', (n) => {
    for (const rounds of [1, 2, 3]) {
      const m = must(plan({ format: 'heats', rounds }), n).matches;
      if (n <= 4) expect(m).toEqual({ low: 1, high: 1 });
      // docs/PLAN.md says 0 or 1 tie-break group; the engine needs up to 3 from 11 players.
      else expect(m).toEqual({ low: rounds * Math.ceil(n / 4) + 1, high: rounds * Math.ceil(n / 4) + 1 + (n <= 10 ? 1 : 3) });
    }
  });

  it('ignores the settings of the other formats', () => {
    const base = must(plan({ format: 'single' }), 12);
    expect(must(plan({ format: 'single', rounds: 3, races: 4, points: [20, 10, 5, 1] }), 12)).toEqual(base);
    const heats = must(plan({ format: 'heats' }), 12);
    expect(must(plan({ format: 'heats', bestOf: 5 }), 12)).toEqual(heats);
  });
});

describe('waves, 2 to 32 players', () => {
  const cases = FORMATS.flatMap((format) => COUNTS.filter((n) => n >= minPlayers(format)).map((n) => [format, n] as const));

  it.each(cases)('%s, %i players: a single station plays one match at a time', (format, n) => {
    const e = must(plan({ format, stations: 1 }), n);
    expect(e.waves.low).toBe(e.matches.low);
    expect(e.waves.high).toBe(e.matches.high);
  });

  it.each(cases)('%s, %i players: more stations never take longer, and never beat the matches / stations bound', (format, n) => {
    let before = Infinity;
    for (const stations of STATION_CHOICES) {
      const e = must(plan({ format, stations }), n);
      expect(e.waves.low, `${stations} stations`).toBeLessThanOrEqual(before);
      expect(e.waves.high).toBeGreaterThanOrEqual(e.waves.low);
      expect(e.waves.low).toBeGreaterThanOrEqual(1);
      const live = format === 'heats' ? stations : Math.min(stations, Math.floor(n / 2));
      expect(e.waves.low).toBeGreaterThanOrEqual(Math.ceil((format === 'heats' ? 0 : e.matches.low) / live));
      before = e.waves.low;
    }
  });

  it.each(cases)('%s, %i players: the waves, times the minutes for one match, are the minutes', (format, n) => {
    const e = must(plan({ format, stations: 2 }), n);
    expect(e.minutes.low).toBeCloseTo(e.waves.low * e.minutesPerWave, 9);
    expect(e.minutes.high).toBeCloseTo(e.waves.high * e.minutesPerWave, 9);
  });

  it('takes the round count as the floor: a bracket cannot play round 2 before round 1', () => {
    // 8 stations are more than 4 players can use; the final and the 3rd-place match come after 2 semi-finals.
    expect(must(plan({ format: 'single', stations: 8 }), 4).waves).toEqual({ low: 2, high: 2 });
    for (const n of COUNTS) {
      const e = must(plan({ format: 'single', stations: 8 }), n);
      expect(e.waves.low).toBeGreaterThanOrEqual(log2Ceil(n));
      const d = n >= 3 ? must(plan({ format: 'double', stations: 8 }), n) : null;
      if (d) {
        expect(d.waves.low).toBeGreaterThanOrEqual(2 * log2Ceil(n));
        // The rematch for the title is one more wave.
        expect(d.waves.high).toBe(d.waves.low + 1);
      }
      if (n >= 2) {
        const r = must(plan({ format: 'round_robin', stations: 8 }), n);
        expect(r.waves.low).toBeGreaterThanOrEqual(n % 2 === 0 ? n - 1 : n);
      }
    }
  });

  it('counts only the stations a bracket can use: floor(n / 2) matches at once', () => {
    for (const format of ['single', 'double', 'round_robin'] as const) {
      for (const n of [3, 4, 5, 6, 7]) {
        const usable = Math.floor(n / 2);
        expect(must(plan({ format, stations: 8 }), n).waves).toEqual(must(plan({ format, stations: usable }), n).waves);
      }
    }
    expect(must(plan({ format: 'single', stations: 8 }), 2).waves).toEqual(must(plan({ format: 'single', stations: 1 }), 2).waves);
  });

  it('counts a round with more matches than stations as several waves (12 players, 3 stations)', () => {
    // Round 1 has 4 matches and round 2 has 4: 2 waves each, then 1, 1, and 1 (final and 3rd place).
    // docs/PLAN.md's max(ceil(M / s), rounds) gives 4 here; the engine needs 6.
    expect(must(plan({ format: 'single', stations: 3 }), 12).waves).toEqual({ low: 6, high: 6 });
  });

  it('groups: rounds x ceil(groups / stations), the final, and a tie-break group', () => {
    const e = must(plan({ format: 'heats', rounds: 2, stations: 3 }), 32);
    // 8 groups on 3 stations is 3 waves a round; 2 rounds, then the final, then up to 2 tie-break passes.
    expect(e.waves).toEqual({ low: 7, high: 9 });
    expect(must(plan({ format: 'heats', rounds: 2, stations: 8 }), 32).waves).toEqual({ low: 3, high: 5 });
    // On one station each tie-break group is a wave.
    expect(must(plan({ format: 'heats', rounds: 2, stations: 1 }), 32).waves).toEqual({ low: 17, high: 20 });
    // 5 players are 2 groups, so 3 rounds on 1 station are 6 waves.
    expect(must(plan({ format: 'heats', rounds: 3, stations: 1 }), 5).waves).toEqual({ low: 7, high: 8 });
    expect(must(plan({ format: 'heats', rounds: 3, stations: 1 }), 4).waves).toEqual({ low: 1, high: 1 });
  });
});

// Played out through the real engine on 2026-11-14: a bracket of numbered players, a result
// for every match on a station, then one rebuild per batch (as `playOutInBatches` in
// packages/server/test/bracket-helpers.ts does), counting the batches. Each row is a
// station count, then the fewest and the most batches over several seeds and winner rules.
type Reference = readonly [stations: number, fewest: number, most: number];
const tolerance = (x: number): number => Math.max(1, 0.1 * x);

const ELIMINATION: ReadonlyArray<readonly [format: 'single' | 'double', n: number, rows: readonly Reference[]]> = [
  ['single', 2, [[1, 1, 1], [2, 1, 1], [3, 1, 1], [8, 1, 1]]],
  ['single', 3, [[1, 2, 2], [2, 2, 2], [3, 2, 2], [8, 2, 2]]],
  ['single', 4, [[1, 4, 4], [2, 2, 2], [3, 2, 2], [8, 2, 2]]],
  ['single', 5, [[1, 5, 5], [2, 3, 3], [3, 3, 3], [8, 3, 3]]],
  ['single', 7, [[1, 7, 7], [2, 4, 4], [3, 3, 3], [8, 3, 3]]],
  ['single', 8, [[1, 8, 8], [2, 4, 4], [3, 4, 4], [8, 3, 3]]],
  ['single', 12, [[1, 12, 12], [2, 6, 6], [3, 6, 6], [8, 4, 4]]],
  ['single', 16, [[1, 16, 16], [2, 8, 8], [3, 6, 6], [8, 4, 4]]],
  ['single', 24, [[1, 24, 24], [2, 12, 12], [3, 9, 9], [8, 5, 5]]],
  ['single', 32, [[1, 32, 32], [2, 16, 16], [3, 12, 12], [8, 6, 6]]],
  ['double', 3, [[1, 4, 5], [2, 4, 5], [3, 4, 5], [8, 4, 5]]],
  ['double', 4, [[1, 6, 7], [2, 4, 5], [3, 4, 5], [8, 4, 5]]],
  ['double', 5, [[1, 8, 9], [2, 6, 7], [3, 6, 7], [8, 6, 7]]],
  ['double', 7, [[1, 12, 13], [2, 8, 9], [3, 6, 7], [8, 6, 7]]],
  ['double', 8, [[1, 14, 15], [2, 8, 9], [3, 7, 8], [8, 6, 7]]],
  ['double', 12, [[1, 22, 23], [2, 13, 14], [3, 10, 11], [8, 8, 9]]],
  ['double', 16, [[1, 30, 31], [2, 17, 18], [3, 12, 13], [8, 8, 9]]],
  ['double', 24, [[1, 46, 47], [2, 25, 26], [3, 18, 19], [8, 11, 12]]],
  ['double', 32, [[1, 62, 63], [2, 33, 34], [3, 23, 24], [8, 13, 14]]],
] as const;

const ROUND_ROBIN: ReadonlyArray<readonly [n: number, rows: readonly Reference[]]> = [
  [2, [[1, 1, 1], [2, 1, 1], [3, 1, 1], [8, 1, 1]]],
  [3, [[1, 3, 6], [2, 3, 6], [3, 3, 6], [8, 3, 6]]],
  [4, [[1, 6, 9], [2, 3, 6], [3, 3, 6], [8, 3, 6]]],
  [6, [[1, 15, 15], [2, 8, 8], [3, 7, 7], [8, 7, 7]]],
  [7, [[1, 21, 21], [2, 11, 11], [3, 7, 7], [8, 7, 7]]],
  [8, [[1, 28, 28], [2, 14, 14], [3, 10, 10], [8, 7, 7]]],
  [10, [[1, 45, 45], [2, 23, 23], [3, 15, 15], [8, 12, 12]]],
  [12, [[1, 66, 66], [2, 33, 33], [3, 22, 22], [8, 13, 13]]],
  [16, [[1, 120, 120], [2, 60, 60], [3, 40, 40], [8, 15, 15]]],
] as const;

describe('waves against the engine', () => {
  it.each(ELIMINATION.flatMap(([format, n, rows]) => rows.map(([stations, fewest, most]) => [format, n, stations, fewest, most] as const)))(
    '%s, %i players, %i stations: engine %i to %i batches',
    (format, n, stations, fewest, most) => {
      const e = must(plan({ format, stations }), n);
      expect(Math.abs(e.waves.low - fewest), `low ${e.waves.low}`).toBeLessThanOrEqual(tolerance(fewest));
      expect(Math.abs(e.waves.high - most), `high ${e.waves.high}`).toBeLessThanOrEqual(tolerance(most));
    },
  );

  it.each(ROUND_ROBIN.flatMap(([n, rows]) => rows.map(([stations, fewest, most]) => [n, stations, fewest, most] as const)))(
    'everyone plays everyone, %i players, %i stations: engine %i to %i batches fit inside the range',
    (n, stations, fewest, most) => {
      // The engine's queue sometimes needs a wave or two more than a perfect packing when
      // stations are many, so the low end is a floor and the range is what has to hold.
      const e = must(plan({ format: 'round_robin', stations }), n);
      expect(fewest).toBeGreaterThanOrEqual(e.waves.low - tolerance(e.waves.low));
      expect(most).toBeLessThanOrEqual(e.waves.high + tolerance(e.waves.high));
    },
  );
});

// The engine's batches for groups, 2016 runs on 2026-11-14 (5 to 32 players, 1, 2, and 4 to 8
// stations, 1 to 3 rounds, 6 seeds each, random finishing orders): every count was inside
// [low, high] of the estimate, widened by max(1, 10%).
describe('groups against the engine', () => {
  const measured: ReadonlyArray<readonly [n: number, stations: number, rounds: number, fewest: number, most: number]> = [
    [5, 1, 1, 3, 3],
    [5, 1, 2, 5, 6],
    [5, 1, 3, 7, 8],
    [5, 2, 1, 2, 2],
    [5, 2, 2, 3, 4],
    [5, 2, 3, 4, 5],
    [5, 8, 1, 2, 2],
    [5, 8, 2, 3, 4],
    [5, 8, 3, 4, 5],
    [6, 1, 1, 3, 3],
    [6, 1, 2, 5, 6],
    [6, 1, 3, 7, 8],
    [6, 2, 1, 2, 2],
    [6, 2, 2, 3, 4],
    [6, 2, 3, 4, 5],
    [6, 8, 1, 2, 2],
    [6, 8, 2, 3, 4],
    [6, 8, 3, 4, 5],
    [8, 1, 1, 3, 3],
    [8, 1, 2, 5, 6],
    [8, 1, 3, 7, 8],
    [8, 2, 1, 2, 2],
    [8, 2, 2, 3, 4],
    [8, 2, 3, 4, 5],
    [8, 8, 1, 2, 2],
    [8, 8, 2, 3, 4],
    [8, 8, 3, 4, 5],
    [9, 1, 1, 5, 5],
    [9, 1, 2, 8, 8],
    [9, 1, 3, 10, 11],
    [9, 2, 1, 4, 4],
    [9, 2, 2, 6, 6],
    [9, 2, 3, 7, 8],
    [9, 8, 1, 3, 3],
    [9, 8, 2, 4, 4],
    [9, 8, 3, 4, 5],
    [11, 1, 1, 5, 5],
    [11, 1, 2, 7, 10],
    [11, 1, 3, 10, 11],
    [11, 2, 1, 4, 4],
    [11, 2, 2, 5, 7],
    [11, 2, 3, 7, 8],
    [11, 8, 1, 3, 3],
    [11, 8, 2, 3, 5],
    [11, 8, 3, 4, 5],
    [13, 1, 1, 5, 5],
    [13, 1, 2, 9, 12],
    [13, 1, 3, 14, 15],
    [13, 2, 1, 3, 3],
    [13, 2, 2, 5, 7],
    [13, 2, 3, 8, 8],
    [13, 8, 1, 2, 2],
    [13, 8, 2, 3, 5],
    [13, 8, 3, 5, 5],
    [16, 1, 1, 5, 5],
    [16, 1, 2, 10, 10],
    [16, 1, 3, 13, 16],
    [16, 2, 1, 3, 3],
    [16, 2, 2, 6, 6],
    [16, 2, 3, 7, 9],
    [16, 8, 1, 2, 2],
    [16, 8, 2, 4, 4],
    [16, 8, 3, 4, 6],
    [20, 1, 1, 8, 8],
    [20, 1, 2, 11, 14],
    [20, 1, 3, 16, 19],
    [20, 2, 1, 5, 5],
    [20, 2, 2, 7, 9],
    [20, 2, 3, 10, 12],
    [20, 8, 1, 3, 3],
    [20, 8, 2, 3, 5],
    [20, 8, 3, 4, 6],
    [24, 1, 1, 9, 9],
    [24, 1, 2, 13, 14],
    [24, 1, 3, 19, 22],
    [24, 2, 1, 5, 5],
    [24, 2, 2, 7, 8],
    [24, 2, 3, 10, 12],
    [24, 8, 1, 3, 3],
    [24, 8, 2, 3, 4],
    [24, 8, 3, 4, 6],
    [32, 1, 1, 11, 11],
    [32, 1, 2, 18, 18],
    [32, 1, 3, 25, 26],
    [32, 2, 1, 6, 6],
    [32, 2, 2, 10, 10],
    [32, 2, 3, 13, 14],
    [32, 8, 1, 3, 3],
    [32, 8, 2, 4, 4],
    [32, 8, 3, 4, 5],
  ];
  it.each(measured)('%i players, %i stations, %i rounds: engine %i to %i batches', (n, stations, rounds, fewest, most) => {
    const e = must(plan({ format: 'heats', stations, rounds }), n);
    expect(fewest).toBeGreaterThanOrEqual(e.waves.low - tolerance(e.waves.low));
    expect(most).toBeLessThanOrEqual(e.waves.high + tolerance(e.waves.high));
    // The low end is the case with no tie-break. With 1 round and 20 players or more a tie at the
    // cut is certain in the engine's runs, so the low end is a floor there, not a target.
    if (rounds > 1 || n < 20) expect(Math.abs(fewest - e.waves.low)).toBeLessThanOrEqual(tolerance(fewest));
  });
});

describe('minutes', () => {
  it('uses 1, 2.5, and 4.125 games for best of 1, 3, and 5', () => {
    expect(EXPECTED_GAMES).toEqual({ 1: 1, 3: 2.5, 5: 4.125 });
    for (const format of ['single', 'double', 'round_robin'] as const) {
      expect(must(plan({ format, bestOf: 1, minutesPerGame: 5, changeoverMinutes: 4 }), 8).minutesPerWave).toBe(9);
      expect(must(plan({ format, bestOf: 3, minutesPerGame: 5, changeoverMinutes: 4 }), 8).minutesPerWave).toBe(16.5);
      expect(must(plan({ format, bestOf: 5, minutesPerGame: 4, changeoverMinutes: 0 }), 8).minutesPerWave).toBe(16.5);
      expect(must(plan({ format, bestOf: 5, minutesPerGame: 5, changeoverMinutes: 4 }), 8).minutesPerWave).toBeCloseTo(24.625, 9);
    }
  });

  it('prices a group as races x minutes per race + changeover, and ignores best of', () => {
    expect(must(plan({ format: 'heats', races: 1, minutesPerGame: 4, changeoverMinutes: 4 }), 12).minutesPerWave).toBe(8);
    expect(must(plan({ format: 'heats', races: 4, minutesPerGame: 4, changeoverMinutes: 4, bestOf: 5 }), 12).minutesPerWave).toBe(20);
  });

  it('works the docs/PLAN.md examples: 16 players, two lives, best of 1, 1 station, 9 minutes a match', () => {
    const e = must(plan({ format: 'double', bestOf: 1, stations: 1, minutesPerGame: 5, changeoverMinutes: 4 }), 16);
    expect(e.matches).toEqual({ low: 30, high: 31 });
    expect(e.waves).toEqual({ low: 30, high: 31 });
    expect(e.minutes).toEqual({ low: 270, high: 279 });
    // The screen shows the high end: about 4 hours 45 minutes.
    expect(displayMinutes(e.minutes.high)).toBe(285);
  });

  it('works the docs/PLAN.md example: 16 players everyone plays everyone on one station', () => {
    const e = must(plan({ format: 'round_robin', bestOf: 1, stations: 1, minutesPerGame: 5, changeoverMinutes: 4 }), 16);
    expect(e.matches).toEqual({ low: 120, high: 123 });
    expect(e.minutes.high).toBe(1107);
    // About 18 hours 30 minutes.
    expect(displayMinutes(e.minutes.high)).toBe(1110);
  });
});

describe('displayMinutes', () => {
  it.each([
    [1, 5],
    [2, 5],
    [7, 5],
    [8, 10],
    [22, 20],
    [23, 25],
    [57, 55],
    [58, 60],
    [59.9, 60],
    [60, 60],
    [67, 60],
    [68, 75],
    [279, 285],
    [270, 270],
    [284, 285],
    [292, 285],
    [293, 300],
    [1107, 1110],
  ])('rounds %f minutes to %i', (minutes, shown) => {
    expect(displayMinutes(minutes)).toBe(shown);
  });

  it('rounds to the nearest 5 under an hour, the nearest 15 from an hour, and never to 0', () => {
    for (let m = 0.5; m < 1500; m += 0.37) {
      const shown = displayMinutes(m);
      expect(shown).toBeGreaterThanOrEqual(5);
      expect(shown % 5).toBe(0);
      if (m >= 60) expect(shown % 15).toBe(0);
      expect(Math.abs(shown - m)).toBeLessThanOrEqual(m < 60 ? 7.5 : 7.5 + 1e-9);
    }
  });
});

describe('isTooLong', () => {
  it('is true when the high end, before rounding, is more than the hours x 60', () => {
    const e = must(plan({ format: 'double', stations: 1 }), 16);
    expect(e.minutes.high).toBe(279);
    expect(isTooLong(e, 4)).toBe(true);
    expect(isTooLong(e, 5)).toBe(false);
    // 279 shows as 285, which is more than 4 hours 40 minutes: the check ignores the rounding.
    const exact: Estimate = { ...e, minutes: { low: 200, high: 240 } };
    expect(isTooLong(exact, 4)).toBe(false);
    expect(isTooLong({ ...exact, minutes: { low: 200, high: 240.5 } }, 4)).toBe(true);
  });

  it('uses the high end, not the low end', () => {
    const e = must(plan({ format: 'double', stations: 1 }), 16);
    expect(isTooLong({ ...e, minutes: { low: 100, high: 280 } }, 4)).toBe(true);
    expect(isTooLong({ ...e, minutes: { low: 300, high: 230 } }, 4)).toBe(false);
  });

  it('is false for a small event in the default plan and true for a big one', () => {
    expect(isTooLong(must(plan(), 4), 3)).toBe(false);
    expect(isTooLong(must(plan({ format: 'round_robin' }), 32), 6)).toBe(true);
  });
});

describe('suggestFixes', () => {
  const ids = (fixes: ReturnType<typeof suggestFixes>): string[] => fixes.map((f) => f.id);

  it('gives at most two, the ones that save the most time', () => {
    const p = plan({ format: 'double', bestOf: 5, stations: 1 });
    const fixes = suggestFixes(p, 16);
    expect(fixes).toHaveLength(FIXES_MAX);
    const now = must(p, 16).minutes.high;
    for (const fix of fixes) {
      expect(fix.savedMinutes).toBeCloseTo(now - fix.estimate.minutes.high, 9);
      expect(fix.savedMinutes).toBeGreaterThan(0);
    }
    expect(fixes[0]!.savedMinutes).toBeGreaterThanOrEqual(fixes[1]!.savedMinutes);
    // One life is 17 matches instead of 31 and best of 1 is 1 game instead of 4.125; both beat a station.
    expect(ids(fixes)).toEqual(expect.arrayContaining(['one-life']));
    expect(ids(fixes)).not.toContain('station');
  });

  it('works each fix out by running the estimate again, and returns the changed plan', () => {
    const p = plan({ format: 'double', bestOf: 3, stations: 2 });
    for (const fix of suggestFixes(p, 20)) {
      expect(isEventPlan(fix.plan)).toBe(true);
      expect(estimatePlan(fix.plan, 20)).toEqual(fix.estimate);
      expect(fix.plan).not.toEqual(p);
    }
    // The input plan is not touched.
    expect(p).toEqual(plan({ format: 'double', bestOf: 3, stations: 2 }));
  });

  it('offers a fix only when it applies to the plan', () => {
    const all = (p: EventPlan, n: number): string[] => ids(suggestFixes(p, n));
    // One life: only for two lives. 1 vs 1 bracket: only from everyone-plays-everyone and groups.
    expect(all(plan({ format: 'single', bestOf: 1, stations: 8 }), 32)).toEqual([]);
    expect(all(plan({ format: 'single', bestOf: 5, stations: 8 }), 32)).toEqual(['best-of-1']);
    expect(all(plan({ format: 'double', bestOf: 1, stations: 8 }), 32)).toEqual(['one-life']);
    expect(all(plan({ format: 'round_robin', bestOf: 1, stations: 8 }), 32)).toEqual(['bracket']);
    // Groups have no best of, and the group fixes need races or rounds to cut. A bracket of 32
    // players is 32 matches, which is longer than 9 groups, so it is not offered.
    expect(all(plan({ format: 'heats', bestOf: 5, races: 1, rounds: 1, stations: 8 }), 32)).toEqual([]);
    // Stations stop at 8.
    expect(all(plan({ format: 'single', bestOf: 1, stations: STATIONS_MAX }), 32)).toEqual([]);
  });

  it('leaves out a fix that saves nothing, and every fix for a count with no estimate', () => {
    // With 2 players, one match can be played at a time, so a station saves nothing.
    expect(ids(suggestFixes(plan({ format: 'single', stations: 1 }), 2))).toEqual([]);
    expect(suggestFixes(plan({ format: 'double' }), 2)).toEqual([]);
    // Two lives with 3 players: one life is 2 matches instead of 4.
    expect(ids(suggestFixes(plan({ format: 'double', stations: 8 }), 3))).toEqual(['one-life']);
  });

  it('suggests group fixes for groups', () => {
    const p = plan({ format: 'heats', races: 4, rounds: 3, stations: 1 });
    const fixes = suggestFixes(p, 32);
    expect(ids(fixes)).toEqual(['fewer-games', 'bracket']);
    expect(fixes[0]!.plan).toMatchObject({ races: 1 });
    const rounds = suggestFixes(plan({ format: 'heats', races: 1, rounds: 3, stations: 8 }), 32);
    expect(ids(rounds)).toContain('one-round');
  });

  it('ranks by minutes saved, keeping the list order for equal savings', () => {
    const p = plan({ format: 'double', bestOf: 3, stations: 1 });
    const saved = suggestFixes(p, 8).map((f) => f.savedMinutes);
    expect([...saved].sort((a, b) => b - a)).toEqual(saved);
  });

  it('every offered fix really is shorter for every count and format', () => {
    for (const format of FORMATS) {
      for (const n of COUNTS.filter((c) => c >= minPlayers(format))) {
        const p = plan({ format, bestOf: 5, races: 4, rounds: 3, stations: 1 });
        const now = must(p, n).minutes.high;
        for (const fix of suggestFixes(p, n)) expect(fix.estimate.minutes.high, `${format} ${n} ${fix.id}`).toBeLessThan(now);
      }
    }
  });
});
