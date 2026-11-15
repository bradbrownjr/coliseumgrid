// When a tie-break is called (docs/PLAN.md, "Waiting for a missing player" and "Ties"): the
// station it fills is called at the time the host pressed Play tie-break, not at the time of the
// last result before it, so the wait for a missing player starts when the players are told. A
// tie-break stored before the review has no time and is called at the last result's time, as it
// was. Undo takes the tie-break and its time away exactly.

import type { BracketMatch, Heat } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { bracketAnswer, startTieBreak, type BracketState } from '../src/bracket-engine.ts';
import { heatsAnswer, startHeatTieBreak, type HeatState } from '../src/heat-engine.ts';
import { at, expectOk, handles, onStations, play, start, undo, type Run } from './bracket-helpers.ts';
import {
  expectOk as expectHeatsOk,
  handles as heatHandles,
  onStations as heatsOnStations,
  listedPick,
  play as playHeat,
  start as startHeats,
  undo as undoHeat,
  type HeatRun,
} from './heat-helpers.ts';

/** A three-way tie in a round robin of three on one station: each player beats the next. */
async function threeWayTie(): Promise<{ run: Run; beforeLast: Run }> {
  let run = await start('round_robin', 3, 1, 1);
  let beforeLast = run;
  const beats = new Map([[1, 2], [2, 3], [3, 1]]);
  while (onStations(run.bracket).length > 0) {
    const m = onStations(run.bracket)[0] as BracketMatch;
    beforeLast = run;
    run = await play(run, m, beats.get(m.slots[0].player?.id as number) === m.slots[1].player?.id ? 0 : 1);
  }
  expect(run.bracket.ties).toHaveLength(1);
  return { run, beforeLast };
}

describe('a round robin tie-break', () => {
  it('is called when the host pressed Play tie-break, not at the last result', async () => {
    const { run } = await threeWayTie();
    const lastResultAt = run.state.results.at(-1)?.at;
    const pressed = at(30);
    const made = expectOk(await startTieBreak(run.state, handles, 5, pressed));
    const station = made.bracket.stations[0];
    expect(station?.match?.side).toBe('tie-break');
    expect(station?.calledAt).toBe(pressed);
    expect(station?.calledAt).not.toBe(lastResultAt);
    expect(made.state.tieBreaks.every((t) => t.at === pressed)).toBe(true);
  });

  it('calls the next tie-break match at the result that freed the station, which came after it was made', async () => {
    const { run } = await threeWayTie();
    // Made at minute 3.5, then a result at minute 4 (the helper times results by the log length):
    // the next tie-break match is called at the result, the later of the two.
    const made = expectOk(await startTieBreak(run.state, handles, 5, new Date(Date.parse(at(3)) + 30_000).toISOString()));
    const played = await play(made, onStations(made.bracket)[0] as BracketMatch, 0);
    expect(played.state.results.at(-1)?.at).toBe(at(4));
    expect(played.bracket.stations[0]?.calledAt).toBe(at(4));
  });

  it('is called at the last result when no time was stored, as before the review', async () => {
    const { run } = await threeWayTie();
    const made = expectOk(await startTieBreak(run.state, handles, 5));
    expect(made.state.tieBreaks.every((t) => !('at' in t))).toBe(true);
    expect(made.bracket.stations[0]?.calledAt).toBe(run.state.results.at(-1)?.at);
  });

  it('is undone exactly: the tie-break and its time go with the result it was made after', async () => {
    const { run, beforeLast } = await threeWayTie();
    const made = expectOk(await startTieBreak(run.state, handles, 5, at(30)));
    const undone = expectOk(await undo(made.state, run.state.results.at(-1)?.id as number));
    expect(undone.state).toEqual(beforeLast.state);
    expect(undone.bracket).toEqual(beforeLast.bracket);
    expect(undone.state.tieBreaks).toEqual([]);
  });

  it('is undone exactly when the tie-break match itself had a result', async () => {
    const { run } = await threeWayTie();
    const made = expectOk(await startTieBreak(run.state, handles, 5, at(30)));
    const played = await play(made, onStations(made.bracket)[0] as BracketMatch, 0);
    const undone = expectOk(await undo(played.state, played.state.results.at(-1)?.id as number));
    expect(undone.state).toEqual(made.state);
    expect(undone.bracket).toEqual(made.bracket);
    expect(undone.bracket.stations[0]?.calledAt).toBe(at(30));
  });

  it('gives the same answer after the state is stored and read back', async () => {
    const { run } = await threeWayTie();
    const made = expectOk(await startTieBreak(run.state, handles, 5, at(30)));
    const loaded = JSON.parse(JSON.stringify(made.state)) as BracketState;
    expect(await bracketAnswer(loaded, handles)).toEqual(made.bracket);
  });
});

/** 12 players in three groups on two stations, the first three groups played so that a tie at the cut waits. */
function heatsTie(): { run: HeatRun; beforeLast: HeatRun } {
  let run = startHeats(12, 12, { stations: 2, rounds: 1 });
  let beforeLast = run;
  // Points 1, 0, 0, 0: every group's winner has 1 point and the rest 0, so 9 players tie at the cut.
  run = expectHeatsOk(
    {
      ok: true,
      state: { ...run.state, settings: { ...run.state.settings, points: [1, 0, 0, 0] } },
      heats: heatsAnswer({ ...run.state, settings: { ...run.state.settings, points: [1, 0, 0, 0] } }, heatHandles),
    },
  );
  while (heatsOnStations(run.heats).length > 0) {
    beforeLast = run;
    const heat = heatsOnStations(run.heats)[0] as Heat;
    run = playHeat(run, heat, listedPick(heat));
  }
  expect(run.heats.ties.length).toBe(1);
  return { run, beforeLast };
}

describe('a groups tie-break', () => {
  it('is called when the host pressed Play tie-break, not at the last result', () => {
    const { run } = heatsTie();
    const lastResultAt = run.state.results.at(-1)?.at;
    const pressed = at(30);
    const made = expectHeatsOk(startHeatTieBreak(run.state, heatHandles, 5, pressed));
    const calls = made.heats.stations.filter((s) => s.heat?.kind === 'tie-break');
    expect(calls.length).toBeGreaterThan(0);
    for (const station of calls) expect(station.calledAt).toBe(pressed);
    expect(made.heats.stations[0]?.calledAt).not.toBe(lastResultAt);
    expect(made.state.tieBreaks.every((t) => t.at === pressed)).toBe(true);
  });

  it('is called at the last result when no time was stored, as before the review', () => {
    const { run } = heatsTie();
    const made = expectHeatsOk(startHeatTieBreak(run.state, heatHandles, 5));
    expect(made.state.tieBreaks.every((t) => !('at' in t))).toBe(true);
    for (const station of made.heats.stations.filter((s) => s.heat)) expect(station.calledAt).toBe(run.state.results.at(-1)?.at);
  });

  it('is undone exactly: the tie-break and its time go with the result it was made after', () => {
    const { run, beforeLast } = heatsTie();
    const made = expectHeatsOk(startHeatTieBreak(run.state, heatHandles, 5, at(30)));
    const undone = expectHeatsOk(undoHeat(made.state, run.state.results.at(-1)?.id as number));
    expect(undone.state).toEqual(beforeLast.state);
    expect(undone.heats).toEqual(beforeLast.heats);
  });

  it('gives the same answer after the state is stored and read back', () => {
    const { run } = heatsTie();
    const made = expectHeatsOk(startHeatTieBreak(run.state, heatHandles, 5, at(30)));
    const loaded = JSON.parse(JSON.stringify(made.state)) as HeatState;
    expect(heatsAnswer(loaded, heatHandles)).toEqual(made.heats);
  });
});
