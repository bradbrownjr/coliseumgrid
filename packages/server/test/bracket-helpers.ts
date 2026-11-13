// Shared driving code for the bracket engine tests: a bracket of numbered players, played
// through its stations the way a host would, with seeded choices so every run is the same.

import { createSeededRandom, type Bracket, type BracketFormat, type BracketMatch, type RandomSource } from '@coliseumgrid/core';
import { expect } from 'vitest';
import {
  bracketAnswer,
  createBracket,
  recordResult,
  startTieBreak,
  type BracketState,
  type EngineAnswer,
  type HandleLookup,
} from '../src/bracket-engine.ts';

/** Players 1 to 40 (32 on time plus room for late players), each with a handle. */
export const handles: HandleLookup = new Map(Array.from({ length: 40 }, (_, i) => [i + 1, `Player${i + 1}`]));

export const ids = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

const START = Date.UTC(2027, 6, 10, 14, 0, 0);
/** A time for the k-th thing done, one minute apart, so every calledAt is distinct. */
export const at = (k: number): string => new Date(START + k * 60_000).toISOString();

export interface Run {
  state: BracketState;
  bracket: Bracket;
}

export function expectOk(answer: EngineAnswer): Run {
  if (!answer.ok) throw new Error(`refused: ${answer.error}`);
  return { state: answer.state, bracket: answer.bracket };
}

export async function start(format: BracketFormat, n: number, seed: number, stations = 2, players = ids(n)): Promise<Run> {
  return expectOk(await createBracket({ id: 1, format, bestOf: 1, stations, playerIds: players, createdAt: at(0) }, createSeededRandom(seed), handles));
}

const nextResultId = (state: BracketState): number => Math.max(0, ...state.results.map((r) => r.id)) + 1;

/** Picks the winner of a match: the slot index. */
export type Pick = (match: BracketMatch) => 0 | 1;
export const randomPick = (random: RandomSource): Pick => () => (random() < 0.5 ? 0 : 1);

/** Records a result for one match on a station. */
export async function play(run: Run, match: BracketMatch, winner: 0 | 1): Promise<Run> {
  const winnerId = match.slots[winner].player?.id as number;
  const answer = await recordResult(run.state, { id: nextResultId(run.state), matchId: match.id, winnerId, at: at(run.state.results.length + 1) }, handles);
  return expectOk(answer);
}

/** The matches on stations now. */
export const onStations = (bracket: Bracket): BracketMatch[] => bracket.stations.flatMap((s) => (s.match ? [s.match] : []));

/**
 * Plays one match from a station, chosen by `random`, or starts a tie-break when nothing is
 * on a station and a tie waits. Null when the bracket has nothing left to play.
 */
export async function step(run: Run, random: RandomSource, pick: Pick): Promise<Run | null> {
  const live = onStations(run.bracket);
  if (live.length === 0) {
    if (run.bracket.ties.some((t) => !t.started)) return expectOk(await startTieBreak(run.state, handles));
    return null;
  }
  const match = live[Math.floor(random() * live.length)] as BracketMatch;
  return play(run, match, pick(match));
}

export async function playOut(run: Run, random: RandomSource, pick: Pick, each?: (before: Run, after: Run) => Promise<void> | void): Promise<Run> {
  let current = run;
  for (;;) {
    const next = await step(current, random, pick);
    if (!next) return current;
    if (each) await each(current, next);
    current = next;
  }
}

/** Every player once, places in order, and 1, 2, and 3 each held by exactly one player. */
export function expectPodium(bracket: Bracket, n: number): void {
  const places = bracket.standings.map((r) => r.place);
  expect(bracket.standings).toHaveLength(n);
  expect(new Set(bracket.standings.map((r) => r.player.id)).size).toBe(n);
  expect(places).toEqual([...places].sort((a, b) => a - b));
  for (const place of [1, 2, 3].slice(0, n)) {
    expect(places.filter((p) => p === place), `place ${place}`).toHaveLength(1);
  }
  // A shared place takes up the places below it: 5, 5, 5, 5, then 9.
  bracket.standings.forEach((row, i) => {
    expect(row.place).toBeLessThanOrEqual(i + 1);
    if (i === 0 || (bracket.standings[i - 1] as { place: number }).place !== row.place) expect(row.place).toBe(i + 1);
  });
}

/**
 * Plays out a bracket quickly: from one answer, records a result for every match on a
 * station, then rebuilds once. A station keeps its match until that match has a result, so
 * each of these was on a station when recorded, exactly as if the host had tapped them one
 * by one. Used where replaying after every tap would take minutes (a round robin of 32 is
 * 496 results).
 */
export async function playOutInBatches(run: Run, random: RandomSource, pick: Pick): Promise<Run> {
  let { state, bracket } = run;
  for (;;) {
    const live = onStations(bracket);
    if (live.length === 0) {
      if (!bracket.ties.some((t) => !t.started)) return { state, bracket };
      ({ state, bracket } = expectOk(await startTieBreak(state, handles)));
      continue;
    }
    const results = [...state.results];
    for (const match of live) {
      const winner = pick(match);
      results.push({
        id: nextResultId({ ...state, results }),
        matchId: match.id,
        winnerId: match.slots[winner].player?.id as number,
        loserId: match.slots[1 - winner]?.player?.id as number,
        at: at(results.length + 1),
      });
    }
    state = { ...state, results };
    bracket = await bracketAnswer(state, handles);
  }
}
