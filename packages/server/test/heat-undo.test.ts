// Undo (src/heat-engine.ts, undoHeatResult): the heats come back exactly as they were
// (CLAUDE.md, rule 5), and an older result comes off only when nothing later depends on it:
// within a round it reopens its heat and moves nothing on a station; a later round, a
// tie-break heat, or the final made from it refuses it.

import { createSeededRandom, type Heat, type Heats } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { FINAL_HEAT_ID, startHeatTieBreak } from '../src/heat-engine.ts';
import { at, expectFinished, expectOk, handles, listedPick, logLength, onStations, play, playOut, randomPick, start, undo, type HeatRun } from './heat-helpers.ts';

const heat = (heats: Heats, id: number): Heat => heats.heats.find((h) => h.id === id) as Heat;
const resultIdOf = (heats: Heats, id: number): number => heat(heats, id).resultId as number;
const playListed = (run: HeatRun, id: number): HeatRun => play(run, heat(run.heats, id), listedPick(heat(run.heats, id)));
const stationsOf = (heats: Heats): Array<[number | undefined, string | null]> => heats.stations.map((s) => [s.heat?.id, s.calledAt]);

/** Undoes the newest result and checks the answer and the state are exactly the earlier ones. */
function expectUndoRestores(before: HeatRun, after: HeatRun): void {
  const last = after.state.results.at(-1);
  if (!last) throw new Error('nothing was recorded');
  const undone = expectOk(undo(after.state, last.id));
  expect(undone.heats).toEqual(before.heats);
  expect(undone.state).toEqual(before.state);
}

describe('undo of the newest result', () => {
  it('restores the answer exactly after every result, across rounds, tie-breaks, and the final', () => {
    let checks = 0;
    for (const n of [2, 3, 4, 5, 6, 7, 9, 12, 13, 16, 21, 27, 32]) {
      for (const rounds of [1, 2, 3]) {
        const random = createSeededRandom(n * 7 + rounds);
        playOut(start(n, n + rounds, { stations: 1 + ((n + rounds) % 4), rounds }), random, randomPick(random), (before, after) => {
          // A tie-break being made is a step too, but not a result.
          if (after.state.results.length === before.state.results.length) return;
          expectUndoRestores(before, after);
          checks++;
        });
      }
    }
    expect(checks).toBeGreaterThan(250);
  });

  it('takes back the tie-break heats made after it', () => {
    // 5 players, listed order: a tie of 2 at the cut once round 2 is done (heat-engine.test.ts).
    let run = start(5, 21, { stations: 2, rounds: 2 });
    for (const id of [101, 102, 201, 202]) run = playListed(run, id);
    const tied = run;
    run = expectOk(startHeatTieBreak(run.state, handles));
    const undone = expectOk(undo(run.state, run.state.results.at(-1)?.id as number));
    expect(undone.state.tieBreaks).toEqual([]);
    expect(undone.heats.heats.some((h) => h.kind === 'tie-break')).toBe(false);
    expect(undone.heats.round).toBe(2);
    // Recording the same result again asks for the same tie-break.
    expect(playListed(undone, 202).heats).toEqual(tied.heats);
  });
});

describe('undo of an older result', () => {
  it('reopens the heat onto an idle station and moves nothing being played', () => {
    // 12 players in three heats of 4 on 2 stations.
    let run = start(12, 12, { stations: 2, rounds: 2 });
    expect(stationsOf(run.heats)).toEqual([
      [101, at(0)],
      [102, at(0)],
    ]);
    run = playListed(run, 101); // station 1 calls 103
    run = playListed(run, 102); // station 2 sits idle: round 2 waits for 103
    expect(stationsOf(run.heats)).toEqual([
      [103, at(1)],
      [undefined, null],
    ]);
    const done102 = heat(run.heats, 102);
    const reopened = expectOk(undo(run.state, resultIdOf(run.heats, 101)));
    expect(stationsOf(reopened.heats)).toEqual([
      [103, at(1)],
      [101, at(3)],
    ]);
    expect(heat(reopened.heats, 101)).toMatchObject({ status: 'playing', order: null, resultId: null });
    expect(heat(reopened.heats, 102)).toEqual(done102);
    expect(reopened.state.results[0]?.undone).toEqual({ step: 2, at: at(3) });
    expect(reopened.heats.lastResultId).toBe(done102.resultId);

    // It is played again, and round 2 follows as usual.
    run = playListed(play(reopened, heat(reopened.heats, 101), [...listedPick(heat(reopened.heats, 101))].reverse()), 103);
    expect(run.heats.round).toBe(2);
    expect(logLength(run.state)).toBe(5);
  });

  it('puts a reopened heat at the front of Up next when every station is busy', () => {
    // 16 players in four heats of 4 on 1 station.
    let run = start(16, 16, { stations: 1, rounds: 1 });
    run = playListed(playListed(run, 101), 102);
    expect(run.heats.upNext.map((h) => h.id)).toEqual([104]);
    const reopened = expectOk(undo(run.state, resultIdOf(run.heats, 101)));
    expect(stationsOf(reopened.heats)).toEqual([[103, at(2)]]);
    expect(reopened.heats.upNext.map((h) => h.id)).toEqual([101, 104]);
    const next = playListed(reopened, 103);
    expect(stationsOf(next.heats)).toEqual([[101, at(4)]]);
  });

  it('reopens a tie-break heat while the rest of its pass is played', () => {
    // A tie of 9 at the cut, split into three tie-break heats of 3 on 2 stations.
    let run = start(12, 12, { stations: 2, rounds: 1, points: [1, 0, 0, 0] });
    for (const id of [101, 102, 103]) run = playListed(run, id);
    run = expectOk(startHeatTieBreak(run.state, handles));
    expect(stationsOf(run.heats)).toEqual([
      [1000, at(3)],
      [1001, at(3)],
    ]);
    run = playListed(playListed(run, 1000), 1001);
    expect(stationsOf(run.heats)).toEqual([
      [1002, at(4)],
      [undefined, null],
    ]);
    const reopened = expectOk(undo(run.state, resultIdOf(run.heats, 1000)));
    expect(stationsOf(reopened.heats)).toEqual([
      [1002, at(4)],
      [1000, at(6)],
    ]);
    expect(reopened.heats.ties).toMatchObject([{ place: 4, started: true }]);
    const random = createSeededRandom(8);
    expectFinished(playOut(reopened, random, randomPick(random)).heats, 12, 'reopened tie-break');
  });

  it('is refused once a later round was made from it', () => {
    let run = start(12, 12, { stations: 3, rounds: 2 });
    for (const id of [101, 102, 103]) run = playListed(run, id);
    expect(run.heats.round).toBe(2);
    for (const id of [101, 102]) expect(undo(run.state, resultIdOf(run.heats, id))).toEqual({ ok: false, error: 'undo-later-first' });
    // Even once round 2 is under way.
    run = playListed(run, 201);
    expect(undo(run.state, resultIdOf(run.heats, 103))).toEqual({ ok: false, error: 'undo-later-first' });
    // A round 2 result comes off: the round's heats don't depend on each other.
    run = playListed(run, 202);
    expect(undo(run.state, resultIdOf(run.heats, 201)).ok).toBe(true);
  });

  it('is refused once a tie-break heat or the final was made from it', () => {
    let run = start(5, 21, { stations: 2, rounds: 2 });
    for (const id of [101, 102, 201, 202]) run = playListed(run, id);
    run = expectOk(startHeatTieBreak(run.state, handles));
    expect(undo(run.state, resultIdOf(run.heats, 201))).toEqual({ ok: false, error: 'undo-later-first' });
    run = playListed(run, 1000);
    expect(heat(run.heats, FINAL_HEAT_ID).status).toBe('playing');
    for (const id of [101, 201, 202]) expect(undo(run.state, resultIdOf(run.heats, id))).toEqual({ ok: false, error: 'undo-later-first' });
    // The newest, the tie-break result, comes off, and with it the final.
    const undone = expectOk(undo(run.state, resultIdOf(run.heats, 1000)));
    expect(undone.heats.heats.some((h) => h.kind === 'final')).toBe(false);
  });

  it('refuses a result that is not in the log or is already undone', () => {
    let run = start(16, 16, { stations: 1, rounds: 1 });
    expect(undo(run.state, 1)).toEqual({ ok: false, error: 'nothing-to-undo' });
    run = playListed(playListed(run, 101), 102);
    const first = resultIdOf(run.heats, 101);
    const reopened = expectOk(undo(run.state, first));
    expect(undo(reopened.state, first)).toEqual({ ok: false, error: 'nothing-to-undo' });
    expect(undo(reopened.state, 99)).toEqual({ ok: false, error: 'nothing-to-undo' });
  });

  it('takes back the newest result exactly after an older undo', () => {
    let run = start(16, 16, { stations: 2, rounds: 1 });
    run = playListed(playListed(run, 101), 102);
    run = expectOk(undo(run.state, resultIdOf(run.heats, 101)));
    const before = run;
    const live = onStations(run.heats)[0] as Heat;
    const after = play(run, live, listedPick(live));
    expectUndoRestores(before, after);
  });
});
