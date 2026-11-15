// Shared driving code for the heat engine tests: heats of numbered players, played through
// their stations the way a host would, with seeded choices so every run is the same.

import { DEFAULT_POINTS, createSeededRandom, shuffle, type Heat, type Heats, type RandomSource } from '@coliseumgrid/core';
import { expect } from 'vitest';
import {
  createHeats,
  heatsAnswer,
  recordHeatResult,
  startHeatTieBreak,
  undoHeatResult,
  type HeatEngineAnswer,
  type HeatState,
} from '../src/heat-engine.ts';
import { at, handles, ids } from './bracket-helpers.ts';

export { at, handles, ids };

export interface HeatRun {
  state: HeatState;
  heats: Heats;
}

export function expectOk(answer: HeatEngineAnswer): HeatRun {
  if (!answer.ok) throw new Error(`refused: ${answer.error}`);
  return { state: answer.state, heats: answer.heats };
}

export interface StartOptions {
  stations?: number;
  rounds?: number;
  points?: readonly number[];
  players?: number[];
}

export function start(n: number, seed: number, options: StartOptions = {}): HeatRun {
  const { stations = 2, rounds = 2, points = DEFAULT_POINTS, players = ids(n) } = options;
  return expectOk(
    createHeats({ id: 1, stations, races: 4, rounds, points: [...points], playerIds: players, createdAt: at(0) }, createSeededRandom(seed), handles),
  );
}

const nextResultId = (state: HeatState): number => Math.max(0, ...state.results.map((r) => r.id)) + 1;

/** The number of log entries: results, undone ones included, and older undos. */
export const logLength = (state: HeatState): number => state.results.length + state.results.filter((r) => r.undone).length;

/** Undoes a result at the time of the next log entry. */
export const undo = (state: HeatState, resultId: number): HeatEngineAnswer =>
  undoHeatResult(state, { resultId, at: at(logLength(state) + 1) }, handles);

/** Picks a heat's finishing order. */
export type Pick = (heat: Heat) => number[];
export const randomPick = (random: RandomSource): Pick => (heat) => shuffle(heat.players.map((p) => p.id), random);
/** Everyone finishes in the order listed. */
export const listedPick: Pick = (heat) => heat.players.map((p) => p.id);

/** Records a finishing order for a heat on a station. */
export function play(run: HeatRun, heat: Heat, order: number[], missing: number[] = []): HeatRun {
  return expectOk(
    recordHeatResult(
      run.state,
      { id: nextResultId(run.state), heatId: heat.id, order, ...(missing.length > 0 && { missing }), at: at(logLength(run.state) + 1) },
      handles,
    ),
  );
}

/** The heats on stations now. */
export const onStations = (heats: Heats): Heat[] => heats.stations.flatMap((s) => (s.heat ? [s.heat] : []));

/**
 * Plays one heat from a station, chosen by `random`, or starts a tie-break when nothing is on a
 * station and a tie waits. Null when there is nothing left to play.
 */
export function step(run: HeatRun, random: RandomSource, pick: Pick): HeatRun | null {
  const live = onStations(run.heats);
  if (live.length === 0) {
    if (run.heats.ties.some((t) => !t.started)) return expectOk(startHeatTieBreak(run.state, handles));
    return null;
  }
  const heat = live[Math.floor(random() * live.length)] as Heat;
  return play(run, heat, pick(heat));
}

export function playOut(run: HeatRun, random: RandomSource, pick: Pick, each?: (before: HeatRun, after: HeatRun) => void): HeatRun {
  let current = run;
  for (;;) {
    const next = step(current, random, pick);
    if (!next) return current;
    each?.(current, next);
    current = next;
  }
}

/** A restart: the state as stored and loaded back gives the same answer as the live one. */
export function expectRestartSame(run: HeatRun, label: string): void {
  const loaded = JSON.parse(JSON.stringify(run.state)) as HeatState;
  expect(heatsAnswer(loaded, handles), label).toEqual(run.heats);
}

/**
 * A finished event: every player once, places in order, places 1 to 4 (or to the count) from
 * the final and held by one player each, and every player played `rounds` qualifying heats.
 */
export function expectFinished(heats: Heats, n: number, label: string): void {
  expect(heats.finished, label).toBe(true);
  expect(heats.ties, label).toEqual([]);
  expect(heats.standings, label).toHaveLength(n);
  expect(new Set(heats.standings.map((r) => r.player.id)).size, label).toBe(n);
  const places = heats.standings.map((r) => r.place);
  expect(places, label).toEqual([...places].sort((a, b) => a - b));
  const final = heats.heats.find((h) => h.kind === 'final') as Heat;
  expect(final.players, label).toHaveLength(Math.min(n, 4));
  expect(heats.standings.slice(0, final.players.length).map((r) => [r.place, r.player]), label).toEqual(
    (final.order ?? []).map((p, i) => [i + 1, p]),
  );
  // A shared place takes up the places below it: 5, 5, 7.
  heats.standings.forEach((row, i) => {
    expect(row.place, label).toBeLessThanOrEqual(i + 1);
    if (i === 0 || (heats.standings[i - 1] as { place: number }).place !== row.place) expect(row.place, label).toBe(i + 1);
  });
  for (const row of heats.standings) expect(row.heatsPlayed, `${label}: ${row.player.handle}`).toBe(heats.rounds);
  expect(heats.heats.every((h) => h.status === 'done'), label).toBe(true);
  expect(heats.stations.every((s) => s.heat === null) && heats.upNext.length === 0, label).toBe(true);
}

/**
 * Plays out heats quickly, as `playOutInBatches` does for a bracket: records a result for every
 * heat on a station, then rebuilds once, and counts each such set as one wave (batch). A
 * tie-break made along the way starts a wave of its own. Returns the batches played.
 */
export function playOutCountingBatches(run: HeatRun, random: RandomSource, pick: Pick): HeatRun & { batches: number } {
  let { state, heats } = run;
  let batches = 0;
  for (;;) {
    const live = onStations(heats);
    if (live.length === 0) {
      if (!heats.ties.some((t) => !t.started)) return { state, heats, batches };
      ({ state, heats } = expectOk(startHeatTieBreak(state, handles)));
      continue;
    }
    batches += 1;
    const results = [...state.results];
    for (const heat of live) {
      results.push({ id: nextResultId({ ...state, results }), heatId: heat.id, order: pick(heat), at: at(results.length + 1) });
    }
    state = { ...state, results };
    heats = heatsAnswer(state, handles);
  }
}
