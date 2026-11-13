// Undo under random play (src/bracket-engine.ts, undoResult; docs/PLAN.md, "Stations and the
// queue"). Every format at several sizes is played to a finish with random undos of the
// newest result and of older ones mixed in. After every step the test checks that no match
// on a station moved, that the stored state gives the same answer, and at the end that
// places 1 to 3 have one player each.

import { createSeededRandom, type Bracket, type BracketFormat, type BracketMatch, type RandomSource } from '@coliseumgrid/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { bracketAnswer, recordResult, startTieBreak, undoResult, type BracketState } from '../src/bracket-engine.ts';
import { createBracketStore, type BracketStore } from '../src/bracket-store.ts';
import { openDatabase } from '../src/database.ts';
import { at, expectOk, expectPodium, handles, onStations, start, type Run } from './bracket-helpers.ts';

let store: BracketStore;
let eventId: number;

beforeEach(() => {
  const db = openDatabase(':memory:');
  store = createBracketStore(db);
  eventId = Number(db.prepare("INSERT INTO events (name, created_at) VALUES ('Friday', 't')").run().lastInsertRowid);
});

interface Counts {
  newestUndone: number;
  olderUndone: number;
  olderRefused: number;
  steps: number;
}

type Station = Bracket['stations'][number];

/** The number of log entries: results, undone ones included, and older undos. */
const logLength = (state: BracketState): number => state.results.length + state.results.filter((r) => r.undone).length;

/** Every station that held a match still holds it, called at the same time, unless `released` lets it go. */
function expectStationsKept(before: Bracket, after: Bracket, released: (station: Station) => boolean, label: string): void {
  before.stations.forEach((s, i) => {
    if (!s.match || released(s)) return;
    const now = after.stations[i] as Station;
    expect([now.match?.id, now.calledAt], `${label}: station ${s.number}`).toEqual([s.match.id, s.calledAt]);
  });
}

/** Saves the state, loads it back, and checks the loaded state answers exactly as the live one. */
async function expectStoredSame(run: Run, label: string): Promise<void> {
  store.save(eventId, run.state);
  const loaded = store.load(eventId) as BracketState;
  expect(loaded, label).toEqual(run.state);
  expect(await bracketAnswer(loaded, handles), label).toEqual(run.bracket);
}

async function fuzz(format: BracketFormat, n: number, stations: number, seed: number, random: RandomSource, counts: Counts): Promise<Run> {
  // Every run is bracket 1; a stored bracket keeps the settings it was made with.
  store.remove(eventId);
  let run = await start(format, n, seed, stations);
  let clock = 1;
  let undos = 0;
  const label = (): string => `${format} ${n} players ${stations} stations seed ${seed}, step ${counts.steps}`;
  // The answer just before each result, by result id, for checking the newest undo, with
  // the reopened matches waiting then.
  const beforeResult = new Map<number, { run: Run; reopened: Set<number> }>();
  // Matches reopened by an older undo and still in Up next.
  let reopened = new Set<number>();

  for (;;) {
    counts.steps++;
    const live = onStations(run.bracket);
    const standing = run.state.results.filter((r) => !r.undone);
    const last = run.state.results.at(-1);
    const lastIsResult = last !== undefined && isNewest(run.state, last.id);

    if (standing.length > 0 && undos < n * 3 && random() < 0.3) {
      undos++;
      const newest = lastIsResult && random() < 0.4;
      // An older undo picks among the last few results standing, where play most often leaves
      // one that nothing depends on yet.
      const recent = standing.slice(-4);
      const target = newest ? (last as { id: number }) : (recent[Math.floor(random() * recent.length)] as { id: number });
      const targetIsNewest = lastIsResult && target.id === last?.id;
      const answer = await undoResult(run.state, { resultId: target.id, at: at(clock++) }, handles);
      if (targetIsNewest) {
        // The newest always comes off, and gives back exactly what was there before it.
        const next = expectOk(answer);
        const before = beforeResult.get(target.id) as { run: Run; reopened: Set<number> };
        expect(next.state, label()).toEqual(before.run.state);
        expect(next.bracket, label()).toEqual(before.run.bracket);
        reopened = before.reopened;
        // Only the matches its station freed and called go back.
        expectStationsKept(run.bracket, next.bracket, (s) => s.calledAt === (last as { at: string }).at, label());
        counts.newestUndone++;
        run = next;
      } else if (!answer.ok) {
        expect(answer.error, label()).toBe('undo-later-first');
        counts.olderRefused++;
        continue;
      } else {
        const next = { state: answer.state, bracket: answer.bracket };
        const matchId = run.state.results.find((r) => r.id === target.id)?.matchId as number;
        expectStationsKept(run.bracket, next.bracket, () => false, label());
        // Results other than the undone one are unchanged.
        for (const m of run.bracket.matches) {
          if (m.status !== 'done' || m.id === matchId) continue;
          expect(next.bracket.matches.find((x) => x.id === m.id), label()).toEqual(m);
        }
        // The reopened match is on a station now, or in Up next behind only other reopened ones.
        const onStation = next.bracket.stations.find((s) => s.match?.id === matchId);
        if (onStation) {
          expect(onStation.calledAt, label()).toBe(at(clock - 1));
        } else {
          const ids = next.bracket.upNext.map((m) => m.id);
          const place = ids.indexOf(matchId);
          expect(place, label()).toBeGreaterThanOrEqual(0);
          for (const id of ids.slice(0, place)) expect(reopened.has(id), label()).toBe(true);
          reopened.add(matchId);
        }
        counts.olderUndone++;
        run = next;
      }
    } else if (live.length > 0) {
      const match = live[Math.floor(random() * live.length)] as BracketMatch;
      const winner = random() < 0.5 ? 0 : 1;
      const id = Math.max(0, ...run.state.results.map((r) => r.id)) + 1;
      const time = at(clock++);
      const next = expectOk(await recordResult(run.state, { id, matchId: match.id, winnerId: match.slots[winner].player?.id as number, at: time }, handles));
      expectStationsKept(run.bracket, next.bracket, (s) => s.match?.id === match.id, label());
      beforeResult.set(id, { run, reopened });
      run = next;
    } else if (run.bracket.ties.some((t) => !t.started)) {
      const next = expectOk(await startTieBreak(run.state, handles));
      expectStationsKept(run.bracket, next.bracket, () => false, label());
      run = next;
    } else {
      expect(run.bracket.finished, label()).toBe(true);
      return run;
    }
    reopened = new Set(run.bracket.upNext.map((m) => m.id).filter((id) => reopened.has(id)));
    await expectStoredSame(run, label());
  }
}

/** True when the result is the last log entry: no older undo was logged after it. */
function isNewest(state: BracketState, resultId: number): boolean {
  const last = state.results.at(-1);
  if (!last || last.id !== resultId || last.undone) return false;
  const lastStep = logLength(state) - 1;
  return !state.results.some((r) => r.undone && r.undone.step === lastStep);
}

describe('undo under random play', () => {
  const totals: Counts = { newestUndone: 0, olderUndone: 0, olderRefused: 0, steps: 0 };
  const cases: Array<[BracketFormat, number[]]> = [
    ['single', [3, 4, 6, 8, 11, 16]],
    ['double', [3, 5, 8, 12]],
    ['round_robin', [3, 4, 5, 7]],
  ];
  for (const [format, sizes] of cases) {
    for (const n of sizes) {
      it(`moves no match being played, stores every step, and finishes: ${format}, ${n} players`, async () => {
        const counts: Counts = { newestUndone: 0, olderUndone: 0, olderRefused: 0, steps: 0 };
        const random = createSeededRandom(n * 101);
        for (const stations of [1, 3]) {
          for (const seed of [1, 2]) {
            const done = await fuzz(format, n, stations, seed, random, counts);
            expectPodium(done.bracket, n);
          }
        }
        totals.newestUndone += counts.newestUndone;
        totals.olderUndone += counts.olderUndone;
        totals.olderRefused += counts.olderRefused;
        expect(counts.newestUndone).toBeGreaterThan(0);
      });
    }
  }

  // Tests in a file run in order, so this sees the totals of every case above.
  it('tried both kinds of undo, and older undos were both taken and refused', () => {
    expect(totals.newestUndone).toBeGreaterThan(100);
    expect(totals.olderUndone).toBeGreaterThan(50);
    expect(totals.olderRefused).toBeGreaterThan(20);
  });
});
