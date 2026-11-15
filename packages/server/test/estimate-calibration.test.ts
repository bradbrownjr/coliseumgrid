// The time estimate against the real engines (docs/PLAN.md, section 5, "Time estimate",
// "The code"). `estimatePlan` says how many waves an event takes; here each event is played
// out in batches, where a batch is every match or group on a station at one moment, and the
// batches are counted. The count must be within [low - tol, high + tol] of the estimate, with
// tol = max(1, ceil(10% of high)). The tolerance is the plan's; do not widen it to make a
// case pass.
//
// Random winners decide the double elimination rematch and the ties, so each case is played
// with several seeds: the high end has to cover the unlucky ones, and the low end the lucky.

import { DEFAULT_POINTS, createSeededRandom, estimatePlan, planDefaults, type EventPlan, type PlanFormat } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { playOutCountingBatches as playBracketBatches, randomPick, start as startBracket } from './bracket-helpers.ts';
import { createHeats } from '../src/heat-engine.ts';
import { at, handles, ids, playOutCountingBatches as playHeatBatches, randomPick as randomOrder } from './heat-helpers.ts';

const SIZES = [2, 3, 4, 5, 7, 8, 9, 12, 16, 17, 26, 32];
const STATIONS = [1, 2, 3, 4, 8];
const SEEDS = [1, 2, 3];
/** An everyone-plays-everyone bracket of more than 12 players is hundreds of matches. */
const ROUND_ROBIN_MAX = 12;

/** The tie-break matches the estimate counts: a three-way tie is one round of 3. */
const TIE_BREAK_MATCHES = 3;
/** Runs that needed more tie-break matches than the estimate counts, for the report below. */
const uncovered: string[] = [];
let roundRobinRuns = 0;

const tolerance = (high: number): number => Math.max(1, Math.ceil(high * 0.1));

interface Case {
  label: string;
  low: number;
  high: number;
  /** The batches the engine needed, once per seed. A run the estimate doesn't claim to cover is null. */
  played: Array<number | null>;
}

/** Every case that is outside the estimate's range, for one readable failure. */
function outside(cases: readonly Case[]): string[] {
  return cases.flatMap((c) => {
    const tol = tolerance(c.high);
    return c.played.flatMap((batches, i) =>
      batches === null ? [] : batches < c.low - tol || batches > c.high + tol
        ? [`${c.label} seed ${SEEDS[i]}: engine ${batches} waves, estimate ${c.low}-${c.high} (allowed ${c.low - tol}-${c.high + tol})`]
        : [],
    );
  });
}

function plan(format: PlanFormat, stations: number, rounds = 2): EventPlan {
  return { ...planDefaults('fighting'), format, stations, rounds };
}

async function bracketCases(format: 'single' | 'double' | 'round_robin'): Promise<Case[]> {
  const cases: Case[] = [];
  for (const n of SIZES) {
    if (format === 'round_robin' && n > ROUND_ROBIN_MAX) continue;
    for (const stations of STATIONS) {
      const estimate = estimatePlan(plan(format, stations), n);
      // Two lives needs 3 players; there is no estimate and no event.
      if (!estimate) continue;
      const played: Array<number | null> = [];
      for (const seed of SEEDS) {
        const random = createSeededRandom(seed * 1000 + n * 10 + stations);
        const run = await playBracketBatches(await startBracket(format, n, seed + n, stations), random, randomPick(random));
        expect(run.bracket.finished, `${format} ${n} players, ${stations} stations`).toBe(true);
        if (format === 'round_robin') roundRobinRuns += 1;
        // The estimate counts one tie-break round of up to 3 matches (PLAN.md, "Time estimate",
        // "Matches"). A tie that needs more, such as a tie-break round that is itself a loop or
        // a tie of 4 or more, adds waves the estimate says it doesn't count. Those runs are
        // counted apart, not measured against it.
        if (format === 'round_robin' && run.state.tieBreaks.length > TIE_BREAK_MATCHES) {
          uncovered.push(`${n} players, ${stations} stations, seed ${seed}: ${run.state.tieBreaks.length} tie-break matches`);
        }
        played.push(run.state.tieBreaks.length > TIE_BREAK_MATCHES ? null : run.batches);
      }
      cases.push({ label: `${format}, ${n} players, ${stations} stations`, low: estimate.waves.low, high: estimate.waves.high, played });
    }
  }
  return cases;
}

describe('estimatePlan waves against the real engines, played out in batches', () => {
  for (const format of ['single', 'double', 'round_robin'] as const) {
    it(`${format}: within [low - tol, high + tol] for every size and station count`, { timeout: 600_000 }, async () => {
      const cases = await bracketCases(format);
      expect(cases.length).toBeGreaterThan(40 - (format === 'round_robin' ? 20 : 0));
      expect(outside(cases)).toEqual([]);
    });
  }

  for (const rounds of [1, 2, 3]) {
    it(`groups, ${rounds} round${rounds > 1 ? 's' : ''} before the final: within [low - tol, high + tol] for every size and station count`, { timeout: 600_000 }, () => {
      const cases: Case[] = [];
      for (const n of SIZES) {
        for (const stations of STATIONS) {
          const estimate = estimatePlan(plan('heats', stations, rounds), n);
          if (!estimate) continue;
          const played: number[] = [];
          for (const seed of SEEDS) {
            const random = createSeededRandom(seed * 1000 + n * 10 + stations);
            const made = createHeats(
              { id: 1, stations, races: 1, rounds, points: [...DEFAULT_POINTS], playerIds: ids(n), createdAt: at(0) },
              createSeededRandom(seed + n),
              handles,
            );
            if (!made.ok) throw new Error(`refused: ${made.error}`);
            const run = playHeatBatches({ state: made.state, heats: made.heats }, random, randomOrder(random));
            expect(run.heats.finished, `${n} players, ${stations} stations`).toBe(true);
            played.push(run.batches);
          }
          cases.push({ label: `groups, ${rounds} rounds, ${n} players, ${stations} stations`, low: estimate.waves.low, high: estimate.waves.high, played });
        }
      }
      expect(cases.length).toBeGreaterThan(50);
      expect(outside(cases)).toEqual([]);
    });
  }
});

describe('what the estimate does not cover', () => {
  it('is a minority of the round robin runs: ties that need more than one tie-break round of 3 matches', () => {
    // Printed so a change to the estimate or the engine shows in the output. Out of 120 runs
    // on 2026-11-15, 10 needed 6 to 12 tie-break matches (a loop among 3 players repeats, or
    // 4 or more are level), and each of those ran past the estimate's high end.
    console.info(`round robin runs with more than ${TIE_BREAK_MATCHES} tie-break matches: ${uncovered.length} of ${roundRobinRuns}`, uncovered);
    expect(roundRobinRuns).toBeGreaterThan(100);
    expect(uncovered.length / roundRobinRuns).toBeLessThan(0.15);
  });
});
