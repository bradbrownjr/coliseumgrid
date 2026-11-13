// Late sign-up (src/heat-engine.ts, joinHeatsLate; docs/PLAN.md, "Late sign-up"): a late
// player joins the smallest round 1 heat still waiting with room, plays as many heats as
// everyone else, and nothing played or called changes.

import { HEAT_SIZE_MAX, createSeededRandom, type Heat, type Heats } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { joinHeatsLate } from '../src/heat-engine.ts';
import { expectFinished, expectOk, expectRestartSame, handles, listedPick, onStations, play, playOut, randomPick, start, step, undo, type HeatRun } from './heat-helpers.ts';

const LATE = 40;

const heat = (heats: Heats, id: number): Heat => heats.heats.find((h) => h.id === id) as Heat;
const idsOf = (h: Heat): number[] => h.players.map((p) => p.id);
const roundOne = (heats: Heats): Heat[] => heats.heats.filter((h) => h.kind === 'round' && h.round === 1);
const join = (run: HeatRun, playerId: number) => joinHeatsLate(run.state, playerId, handles);

/** Every heat with a result or on a station is the same heat, with the same players, after the join, and every station is as it was. */
function expectOnTimeUnchanged(before: Heats, after: Heats): void {
  for (const h of before.heats) {
    if (h.status === 'done' || h.status === 'playing') expect(heat(after, h.id), `heat ${h.id}`).toEqual(h);
  }
  expect(after.stations).toEqual(before.stations);
}

describe('late sign-up', () => {
  it('fills the smallest waiting round 1 heat, the lowest number on a tie, until none has room', () => {
    // 10 players are heats of 4, 3, and 3; with 1 station heat 101 is called and the others wait.
    const run = start(10, 10, { stations: 1, rounds: 2 });
    expect(run.heats.lateOpen).toBe(true);
    const one = expectOk(join(run, LATE));
    expect(one.state.lateJoins).toEqual([{ playerId: LATE, heatId: 102, step: 0 }]);
    expect(idsOf(heat(one.heats, 102)).at(-1)).toBe(LATE);
    expectOnTimeUnchanged(run.heats, one.heats);
    // The heats wait in the same order.
    expect(one.heats.upNext.map((h) => h.id)).toEqual(run.heats.upNext.map((h) => h.id));

    const two = expectOk(join(one, LATE - 1));
    expect(two.state.lateJoins.at(-1)).toEqual({ playerId: LATE - 1, heatId: 103, step: 0 });
    expectOnTimeUnchanged(one.heats, two.heats);
    expect(two.heats.lateOpen).toBe(false);
    expect(join(two, LATE - 2)).toEqual({ ok: false, error: 'late-closed' });

    // Both late players play as many heats as everyone else, and later rounds split 12.
    const random = createSeededRandom(10);
    const done = playOut(two, random, randomPick(random));
    expectFinished(done.heats, 12, 'two late players');
    expect(done.heats.heats.filter((h) => h.kind === 'round' && h.round === 2).map((h) => h.players.length)).toEqual([4, 4, 4]);
    expectRestartSame(done, 'two late players');
  });

  it('stores the step a player joined at, and leaves heats already called alone', () => {
    let run = start(10, 10, { stations: 1, rounds: 1 });
    run = play(run, heat(run.heats, 101), listedPick(heat(run.heats, 101)));
    // Heat 102 is on the station now, so 103 is the only one waiting.
    const joined = expectOk(join(run, LATE));
    expect(joined.state.lateJoins).toEqual([{ playerId: LATE, heatId: 103, step: 1 }]);
    expectOnTimeUnchanged(run.heats, joined.heats);
  });

  it('closes when every round 1 heat is called at the start', () => {
    const run = start(8, 8, { stations: 2, rounds: 2 });
    expect(run.heats.lateOpen).toBe(false);
    expect(join(run, LATE)).toEqual({ ok: false, error: 'late-closed' });
  });

  it('closes when no waiting heat has room', () => {
    // 16 players are four heats of 4.
    const run = start(16, 16, { stations: 1, rounds: 2 });
    expect(run.heats.lateOpen).toBe(false);
    expect(join(run, LATE)).toEqual({ ok: false, error: 'late-closed' });
  });

  it('closes once round 1 is finished, and never takes a heat that was played and reopened', () => {
    let run = start(9, 9, { stations: 1, rounds: 2 });
    run = play(run, heat(run.heats, 101), listedPick(heat(run.heats, 101)));
    run = play(run, heat(run.heats, 102), listedPick(heat(run.heats, 102)));
    // 103 is on the station; 101 and 102 were played.
    expect(run.heats.lateOpen).toBe(false);
    const reopened = expectOk(undo(run.state, heat(run.heats, 101).resultId as number));
    expect(heat(reopened.heats, 101).status).toBe('ready');
    expect(reopened.heats.lateOpen).toBe(false);
    run = play(run, heat(run.heats, 103), listedPick(heat(run.heats, 103)));
    expect(run.heats.round).toBe(2);
    expect(join(run, LATE)).toEqual({ ok: false, error: 'late-closed' });
  });

  it('closes with 2 to 4 players, whose one heat is the final', () => {
    for (const n of [2, 3, 4]) {
      const run = start(n, n, { stations: 1 });
      expect(run.heats.lateOpen).toBe(false);
      expect(join(run, LATE)).toEqual({ ok: false, error: 'late-closed' });
    }
  });

  it('refuses a player already in, or one who is not there', () => {
    const run = start(10, 10, { stations: 1 });
    expect(join(run, run.state.seeding[0] as number)).toEqual({ ok: false, error: 'already-in' });
    const joined = expectOk(join(run, LATE));
    expect(join(joined, LATE)).toEqual({ ok: false, error: 'already-in' });
    expect(join(run, 99)).toEqual({ ok: false, error: 'not-found' });
  });
});

describe('late sign-up under random play', () => {
  it('takes players at random steps into the smallest waiting heat, and changes nothing played or called', () => {
    let accepted = 0;
    let refused = 0;
    for (let n = 5; n <= 31; n += 2) {
      for (const stations of [1, 2, 3]) {
        const rounds = 1 + ((n + stations) % 3);
        const label = `${n} players, ${stations} stations, ${rounds} rounds`;
        const random = createSeededRandom(n * 13 + stations);
        let run = start(n, n * 13 + stations, { stations, rounds });
        let late = LATE;
        let players = n;
        for (;;) {
          if (random() < 0.3) {
            const before = run.heats;
            const answer = join(run, late);
            const waiting = roundOne(before).filter((h) => h.status === 'ready' && h.players.length < HEAT_SIZE_MAX);
            if (answer.ok) {
              const smallest = Math.min(...waiting.map((h) => h.players.length));
              const into = answer.state.lateJoins.at(-1)?.heatId;
              expect(into, label).toBe(waiting.find((h) => h.players.length === smallest)?.id);
              expectOnTimeUnchanged(before, answer.heats);
              expect(before.lateOpen, label).toBe(true);
              run = { state: answer.state, heats: answer.heats };
              accepted++;
              players++;
              late--;
            } else {
              expect(answer.error, label).toBe('late-closed');
              expect(waiting, label).toEqual([]);
              expect(before.lateOpen, label).toBe(false);
              refused++;
            }
            expectRestartSame(run, label);
          }
          const next = step(run, random, randomPick(random));
          if (!next) break;
          run = next;
        }
        expectFinished(run.heats, players, label);
        expect(onStations(run.heats), label).toEqual([]);
      }
    }
    expect(accepted).toBeGreaterThan(20);
    expect(refused).toBeGreaterThan(50);
  });
});
