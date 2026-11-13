// Undo under random play (src/heat-engine.ts, undoHeatResult; docs/PLAN.md, "Stations and the
// queue"). Heats at many counts are played to a finished final with random undos of the
// newest result and of older ones mixed in. After every step the test checks that no heat on
// a station moved, that a restart from the stored state gives the same answer, and at the
// end that places 1 to 4 come from the final.

import { createSeededRandom, shuffle, type Heat, type Heats, type RandomSource } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { recordHeatResult, startHeatTieBreak, undoHeatResult, type HeatState } from '../src/heat-engine.ts';
import { at, expectFinished, expectOk, expectRestartSame, handles, logLength, onStations, start, type HeatRun } from './heat-helpers.ts';

interface Counts {
  newestUndone: number;
  olderUndone: number;
  olderRefused: number;
  steps: number;
}

type Station = Heats['stations'][number];

/** Every station that held a heat still holds it, called at the same time, unless `released` lets it go. */
function expectStationsKept(before: Heats, after: Heats, released: (station: Station) => boolean, label: string): void {
  before.stations.forEach((s, i) => {
    if (!s.heat || released(s)) return;
    const now = after.stations[i] as Station;
    expect([now.heat?.id, now.heat?.players, now.calledAt], `${label}: station ${s.number}`).toEqual([s.heat.id, s.heat.players, s.calledAt]);
  });
}

/** True when the result is the last log entry: no older undo was logged after it. */
function isNewest(state: HeatState, resultId: number): boolean {
  const last = state.results.at(-1);
  if (!last || last.id !== resultId || last.undone) return false;
  const lastStep = logLength(state) - 1;
  return !state.results.some((r) => r.undone && r.undone.step === lastStep);
}

function fuzz(n: number, stations: number, rounds: number, seed: number, random: RandomSource, counts: Counts): HeatRun {
  let run = start(n, seed, { stations, rounds });
  let clock = 1;
  let undos = 0;
  const label = (): string => `${n} players ${stations} stations ${rounds} rounds seed ${seed}, step ${counts.steps}`;
  // The answer just before each result, by result id, for checking the newest undo, with the
  // heats reopened and waiting then.
  const beforeResult = new Map<number, { run: HeatRun; reopened: Set<number> }>();
  // Heats reopened by an older undo and still in Up next.
  let reopened = new Set<number>();

  for (;;) {
    counts.steps++;
    const live = onStations(run.heats);
    const standing = run.state.results.filter((r) => !r.undone);
    const last = run.state.results.at(-1);
    const lastIsResult = last !== undefined && isNewest(run.state, last.id);

    if (standing.length > 0 && undos < n * 2 && random() < 0.3) {
      undos++;
      const newest = lastIsResult && random() < 0.4;
      // An older undo picks among the last few results standing, where play most often leaves
      // one that nothing depends on yet.
      const recent = standing.slice(-4);
      const target = newest ? (last as { id: number }) : (recent[Math.floor(random() * recent.length)] as { id: number });
      const targetIsNewest = lastIsResult && target.id === last?.id;
      const answer = undoHeatResult(run.state, { resultId: target.id, at: at(clock++) }, handles);
      if (targetIsNewest) {
        // The newest always comes off, and gives back exactly what was there before it.
        const next = expectOk(answer);
        const before = beforeResult.get(target.id) as { run: HeatRun; reopened: Set<number> };
        expect(next.state, label()).toEqual(before.run.state);
        expect(next.heats, label()).toEqual(before.run.heats);
        reopened = before.reopened;
        // Only the heats its station freed and called, or a round it made, go back.
        expectStationsKept(run.heats, next.heats, (s) => s.calledAt === (last as { at: string }).at, label());
        counts.newestUndone++;
        run = next;
      } else if (!answer.ok) {
        expect(answer.error, label()).toBe('undo-later-first');
        counts.olderRefused++;
        continue;
      } else {
        const next = { state: answer.state, heats: answer.heats };
        const heatId = run.state.results.find((r) => r.id === target.id)?.heatId as number;
        expectStationsKept(run.heats, next.heats, () => false, label());
        // Heats other than the reopened one are unchanged, and no heat is added or taken away.
        expect(next.heats.heats.map((h) => h.id), label()).toEqual(run.heats.heats.map((h) => h.id));
        for (const h of run.heats.heats) {
          if (h.status !== 'done' || h.id === heatId) continue;
          expect(next.heats.heats.find((x) => x.id === h.id), label()).toEqual(h);
        }
        // The reopened heat is on a station now, or in Up next behind only other reopened ones.
        const onStation = next.heats.stations.find((s) => s.heat?.id === heatId);
        if (onStation) {
          expect(onStation.calledAt, label()).toBe(at(clock - 1));
        } else {
          const ids = next.heats.upNext.map((h) => h.id);
          const place = ids.indexOf(heatId);
          expect(place, label()).toBeGreaterThanOrEqual(0);
          for (const id of ids.slice(0, place)) expect(reopened.has(id), label()).toBe(true);
          reopened.add(heatId);
        }
        counts.olderUndone++;
        run = next;
      }
    } else if (live.length > 0) {
      const heat = live[Math.floor(random() * live.length)] as Heat;
      const order = shuffle(heat.players.map((p) => p.id), random);
      const id = Math.max(0, ...run.state.results.map((r) => r.id)) + 1;
      const time = at(clock++);
      const next = expectOk(recordHeatResult(run.state, { id, heatId: heat.id, order, at: time }, handles));
      expectStationsKept(run.heats, next.heats, (s) => s.heat?.id === heat.id, label());
      beforeResult.set(id, { run, reopened });
      run = next;
    } else if (run.heats.ties.some((t) => !t.started)) {
      const next = expectOk(startHeatTieBreak(run.state, handles));
      expectStationsKept(run.heats, next.heats, () => false, label());
      run = next;
    } else {
      expect(run.heats.finished, label()).toBe(true);
      return run;
    }
    reopened = new Set(run.heats.upNext.map((h) => h.id).filter((id) => reopened.has(id)));
    expectRestartSame(run, label());
  }
}

describe('undo under random play', () => {
  const totals: Counts = { newestUndone: 0, olderUndone: 0, olderRefused: 0, steps: 0 };
  for (const n of [5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 19, 22, 25, 28, 32]) {
    it(`moves no heat being played, restarts the same after every step, and finishes: ${n} players`, () => {
      const counts: Counts = { newestUndone: 0, olderUndone: 0, olderRefused: 0, steps: 0 };
      const random = createSeededRandom(n * 101);
      for (const stations of [1, 3]) {
        for (const seed of [1, 2]) {
          const rounds = 1 + ((n + seed + stations) % 3);
          const done = fuzz(n, stations, rounds, seed, random, counts);
          expectFinished(done.heats, n, `${n} players ${stations} stations ${rounds} rounds seed ${seed}`);
        }
      }
      for (const key of ['newestUndone', 'olderUndone', 'olderRefused', 'steps'] as const) totals[key] += counts[key];
      expect(counts.newestUndone).toBeGreaterThan(0);
    });
  }

  // Tests in a file run in order, so this sees the totals of every case above.
  it('tried both kinds of undo, and older undos were both taken and refused', () => {
    expect(totals.newestUndone).toBeGreaterThan(100);
    expect(totals.olderUndone).toBeGreaterThan(50);
    expect(totals.olderRefused).toBeGreaterThan(20);
  });
});
