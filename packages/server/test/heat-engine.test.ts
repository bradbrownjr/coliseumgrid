// The heat engine (src/heat-engine.ts): every count from 2 to 32 played to a finished final,
// round 1 from the seeding and later rounds by points, ties at the cut for the final, the
// heat ids, a restart after every step, and what the engine refuses. Undo is in
// heat-undo.test.ts and heat-undo-fuzz.test.ts, late players in heat-late.test.ts.

import { createSeededRandom, regroup, scoreHeats, splitHeats, DEFAULT_POINTS, type Heat, type Heats } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { FINAL_HEAT_ID, createHeats, recordHeatResult, startHeatTieBreak, type HeatState } from '../src/heat-engine.ts';
import {
  at,
  expectFinished,
  expectOk,
  expectRestartSame,
  handles,
  ids,
  listedPick,
  onStations,
  play,
  playOut,
  randomPick,
  start,
  type HeatRun,
} from './heat-helpers.ts';

const idsOf = (heat: Heat): number[] => heat.players.map((p) => p.id);
const heatsOf = (heats: Heats, kind: Heat['kind'], round?: number): Heat[] =>
  heats.heats.filter((h) => h.kind === kind && (round === undefined || h.round === round));
const heat = (heats: Heats, id: number): Heat => heats.heats.find((h) => h.id === id) as Heat;

/** Plays every heat on a station in the listed order until a tie waits or nothing is left. */
function playListed(run: HeatRun): HeatRun {
  let current = run;
  for (let live = onStations(current.heats); live.length > 0; live = onStations(current.heats)) {
    current = play(current, live[0] as Heat, listedPick(live[0] as Heat));
  }
  return current;
}

describe('a whole event', () => {
  // Tie sizes met at the cut across every run below, checked at the end.
  const tieSizes = new Set<number>();

  for (const rounds of [1, 2, 3]) {
    it(`plays every count from 2 to 32 to a finished final, ${rounds} round${rounds > 1 ? 's' : ''}, restarting after every step`, () => {
      for (let n = 2; n <= 32; n++) {
        const stations = 1 + ((n + rounds) % 8);
        const label = `${n} players, ${stations} stations, ${rounds} rounds`;
        const random = createSeededRandom(n * 10 + rounds);
        const run = start(n, n * 10 + rounds, { stations, rounds });
        expectRestartSame(run, label);
        const done = playOut(run, random, randomPick(random), (_, after) => {
          expectRestartSame(after, label);
          for (const t of after.heats.ties) if (!t.started) tieSizes.add(t.players.length);
        });
        expectFinished(done.heats, n, label);
        const qualifying = n > 4 ? rounds : 0;
        expect(done.heats.rounds, label).toBe(qualifying);
        // Every qualifying round is split by the group sizes rule.
        for (let r = 1; r <= qualifying; r++) {
          expect(heatsOf(done.heats, 'round', r).map((h) => h.players.length), `${label}, round ${r}`).toEqual(splitHeats(n));
        }
        // Points are the table's, by place, over the qualifying heats.
        const points = new Map<number, number>();
        for (const h of heatsOf(done.heats, 'round')) {
          (h.order ?? []).forEach((p, i) => points.set(p.id, (points.get(p.id) ?? 0) + (DEFAULT_POINTS[i] as number)));
        }
        for (const row of done.heats.standings) expect(row.points, label).toBe(points.get(row.player.id) ?? 0);
      }
    });
  }

  it('met ties of 2, 3, 4, and more players at the cut, and settled each', () => {
    for (const size of [2, 3, 4]) expect(tieSizes.has(size), `a tie of ${size}`).toBe(true);
    expect(Math.max(...tieSizes)).toBeGreaterThan(4);
  });
});

describe('rounds and the final', () => {
  it('cuts round 1 from the seeding, regroups later rounds by points, and numbers heats by round', () => {
    let run = start(10, 3, { stations: 3, rounds: 3 });
    expect(run.heats.round).toBe(1);
    expect(heatsOf(run.heats, 'round', 1).map((h) => h.id)).toEqual([101, 102, 103]);
    expect(heatsOf(run.heats, 'round', 1).flatMap(idsOf)).toEqual(run.state.seeding);
    expect(run.heats.heats.map((h) => h.status)).toEqual(['playing', 'playing', 'playing']);
    expect(run.heats.finalSize).toBe(4);

    // Round 2 appears only once round 1 has every result, cut from the points so far.
    run = play(run, heat(run.heats, 101), listedPick(heat(run.heats, 101)));
    run = play(run, heat(run.heats, 102), listedPick(heat(run.heats, 102)));
    expect(heatsOf(run.heats, 'round', 2)).toEqual([]);
    run = play(run, heat(run.heats, 103), listedPick(heat(run.heats, 103)));
    expect(run.heats.round).toBe(2);
    const finishes = heatsOf(run.heats, 'round', 1).map((h) => (h.order ?? []).map((p) => p.id));
    expect(heatsOf(run.heats, 'round', 2).map(idsOf)).toEqual(regroup(scoreHeats(run.state.seeding, finishes, DEFAULT_POINTS)));
    expect(heatsOf(run.heats, 'round', 2).map((h) => h.id)).toEqual([201, 202, 203]);
    // Every station was free, so round 2 is called at the time of the result that finished round 1.
    expect(run.heats.stations.map((s) => [s.heat?.id, s.calledAt])).toEqual([
      [201, at(3)],
      [202, at(3)],
      [203, at(3)],
    ]);

    run = playListed(run);
    expect(heatsOf(run.heats, 'round', 3).map((h) => h.id)).toEqual([301, 302, 303]);
    run = playListed(run);
    if (run.heats.ties.length > 0) run = playListed(expectOk(startHeatTieBreak(run.state, handles)));
    expect(run.heats.round).toBeNull();
    expect(run.heats.heats.at(-1)).toMatchObject({ id: FINAL_HEAT_ID, kind: 'final', round: 1, number: 1, status: 'done' });
    expectFinished(run.heats, 10, 'ten players');
  });

  it('sends the top 4 by points to the final, whose order alone gives places 1 to 4', () => {
    const random = createSeededRandom(77);
    let run = start(12, 77, { stations: 3, rounds: 2 });
    run = playOut(run, random, randomPick(random), (_, after) => {
      const final = after.heats.heats.find((h) => h.kind === 'final');
      if (!final || final.status === 'done') return;
      // Before the final, places 1 to 4 are the finalists, in qualifying order.
      expect(after.heats.standings.slice(0, 4).map((r) => r.player)).toEqual(final.players);
      expect(after.heats.standings[4]?.place).toBeGreaterThanOrEqual(5);
    });
    const final = heat(run.heats, FINAL_HEAT_ID);
    expect(run.heats.standings.slice(0, 4).map((r) => [r.place, r.player])).toEqual((final.order ?? []).map((p, i) => [i + 1, p]));
  });

  it('gives 2 to 4 players only the final, with no rounds', () => {
    for (const n of [2, 3, 4]) {
      let run = start(n, n, { stations: 1, rounds: 2 });
      expect(run.heats).toMatchObject({ rounds: 0, round: null, finalSize: n, lateOpen: false, finished: false, ties: [] });
      expect(run.heats.heats.map((h) => [h.id, h.kind, h.status])).toEqual([[FINAL_HEAT_ID, 'final', 'playing']]);
      expect(idsOf(heat(run.heats, FINAL_HEAT_ID))).toEqual(run.state.seeding);
      expect(run.heats.standings.map((r) => [r.place, r.points, r.heatsPlayed])).toEqual(ids(n).map(() => [1, 0, 0]));
      const order = [...run.state.seeding].reverse();
      run = play(run, heat(run.heats, FINAL_HEAT_ID), order);
      expectFinished(run.heats, n, `${n} players`);
      expect(run.heats.standings.map((r) => r.player.id)).toEqual(order);
    }
  });

  it('scores heats of 3 and 2 by their first places from the table', () => {
    // 5 players are a heat of 3 and a heat of 2.
    let run = start(5, 5, { stations: 2, rounds: 1, points: [10, 6, 3, 1] });
    const [three, two] = heatsOf(run.heats, 'round', 1) as [Heat, Heat];
    expect([three.players.length, two.players.length]).toEqual([3, 2]);
    run = play(run, three, idsOf(three));
    run = play(run, two, idsOf(two));
    const pointsOf = (id: number): number | undefined => run.heats.standings.find((r) => r.player.id === id)?.points;
    expect(idsOf(three).map(pointsOf)).toEqual([10, 6, 3]);
    expect(idsOf(two).map(pointsOf)).toEqual([10, 6]);
  });
});

describe('ties at the cut for the final', () => {
  it('plays a tie of 2 at 4th off in one race, and its order stands below the cut', () => {
    // 5 players over 2 rounds, every heat finishing in the listed order: the 4th and 5th
    // players of the seeding end level on 5 points, across the cut.
    let run = playListed(start(5, 21, { stations: 2, rounds: 2 }));
    const [s0, s1, s2, s3, s4] = run.state.seeding as [number, number, number, number, number];
    expect(run.heats.ties).toEqual([{ place: 4, players: [s1, s2].map((id) => ({ id, handle: `Player${id}` })), started: false }]);
    expect(run.heats.heats.some((h) => h.kind === 'final')).toBe(false);
    expect(run.heats.finished).toBe(false);
    expect(run.heats.round).toBeNull();

    run = expectOk(startHeatTieBreak(run.state, handles));
    expect(run.heats.ties).toMatchObject([{ place: 4, started: true }]);
    expect(run.state.tieBreaks).toEqual([{ players: [s1, s2], step: 4 }]);
    const tieBreak = heat(run.heats, 1000);
    expect(tieBreak).toMatchObject({ kind: 'tie-break', round: 1, number: 1, status: 'playing' });
    expect(startHeatTieBreak(run.state, handles)).toEqual({ ok: false, error: 'no-tie' });

    run = play(run, tieBreak, [s2, s1]);
    expect(run.heats.ties).toEqual([]);
    expect(idsOf(heat(run.heats, FINAL_HEAT_ID))).toEqual([s0, s3, s4, s2]);
    run = play(run, heat(run.heats, FINAL_HEAT_ID), [s4, s0, s3, s2]);
    expect(run.heats.standings.map((r) => [r.place, r.player.id, r.points])).toEqual([
      [1, s4, 7],
      [2, s0, 8],
      [3, s3, 7],
      [4, s2, 5],
      [5, s1, 5],
    ]);
    expectFinished(run.heats, 5, 'tie of 2');
  });

  it('settles a tie of 4 in one race of 4', () => {
    // Heats of 3 and 3 on 3, 1, 1: two winners on 3, four players level on 1 for places 3 to 6.
    let run = playListed(start(6, 6, { stations: 2, rounds: 1, points: [3, 1, 1, 0] }));
    expect(run.heats.ties).toMatchObject([{ place: 3, started: false }]);
    expect(run.heats.ties[0]?.players).toHaveLength(4);
    run = playListed(expectOk(startHeatTieBreak(run.state, handles)));
    expect(heatsOf(run.heats, 'tie-break').map((h) => h.players.length)).toEqual([4]);
    expectFinished(run.heats, 6, 'tie of 4');
  });

  it('splits a tie of 6 into two races of 3, which settle it', () => {
    // Heats of 4 and 4 on 1, 0, 0, 0: two winners, six players level on 0 for places 3 to 8.
    let run = playListed(start(8, 8, { stations: 2, rounds: 1, points: [1, 0, 0, 0] }));
    expect(run.heats.ties[0]?.players).toHaveLength(6);
    run = expectOk(startHeatTieBreak(run.state, handles));
    expect(heatsOf(run.heats, 'tie-break').map((h) => [h.id, h.round, h.number, h.players.length])).toEqual([
      [1000, 1, 1, 3],
      [1001, 1, 2, 3],
    ]);
    run = playListed(run);
    expect(run.heats.ties).toEqual([]);
    expectFinished(run.heats, 8, 'tie of 6');
    // The tie-break winners reach the final; the rest share places by their tie-break place.
    expect(run.heats.standings.map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 5, 7, 7]);
  });

  it('plays a second pass for players still level across the cut', () => {
    // Three heats of 4 on 1, 0, 0, 0: three winners, nine level for 4th. The first pass is
    // three races of 3, and their three winners are still level across the cut.
    let run = playListed(start(12, 12, { stations: 1, rounds: 1, points: [1, 0, 0, 0] }));
    expect(run.heats.ties[0]?.players).toHaveLength(9);
    run = playListed(expectOk(startHeatTieBreak(run.state, handles)));
    expect(run.heats.ties).toMatchObject([{ place: 4, started: false }]);
    expect(run.heats.ties[0]?.players).toHaveLength(3);
    run = expectOk(startHeatTieBreak(run.state, handles));
    expect(heatsOf(run.heats, 'tie-break').map((h) => [h.id, h.round, h.number])).toEqual([
      [1000, 1, 1],
      [1001, 1, 2],
      [1002, 1, 3],
      [1003, 2, 1],
    ]);
    run = playListed(run);
    expectFinished(run.heats, 12, 'second pass');
    // A restart works out the passes from the steps the tie-break heats were made at.
    expectRestartSame(run, 'second pass');
  });
});

describe('refusals', () => {
  const create = (changes: Partial<{ stations: number; races: number; rounds: number; points: number[]; playerIds: number[] }>) =>
    createHeats({ id: 1, stations: 2, races: 4, rounds: 2, points: [4, 3, 2, 1], playerIds: ids(8), createdAt: at(0), ...changes }, createSeededRandom(1), handles);

  it('refuses settings out of range, and too few or too many players', () => {
    for (const changes of [
      { stations: 0 },
      { stations: 9 },
      { races: 0 },
      { races: 5 },
      { rounds: 0 },
      { rounds: 4 },
      { rounds: 1.5 },
      { points: [4, 3, 2] },
      { points: [1, 2, 0, 0] },
      { points: [0, 0, 0, 0] },
      { points: [21, 3, 2, 1] },
      { playerIds: [1, 2, 2] },
      { playerIds: [1, 99] },
    ]) {
      expect(create(changes), JSON.stringify(changes)).toEqual({ ok: false, error: 'bad-request' });
    }
    expect(create({ playerIds: [1] })).toEqual({ ok: false, error: 'too-few-players' });
    expect(create({ playerIds: ids(33) })).toEqual({ ok: false, error: 'too-many-players' });
  });

  it('stores rounds as 0 with 2 to 4 players, whatever was asked', () => {
    for (const rounds of [0, 1, 3]) {
      const made = create({ rounds, playerIds: ids(4) });
      expect(made.ok && made.state.settings.rounds).toBe(0);
    }
  });

  it('records only a heat on a station, with each of its players once', () => {
    const run = start(12, 4, { stations: 1, rounds: 1 });
    const [playing, waiting] = heatsOf(run.heats, 'round', 1) as [Heat, Heat];
    const record = (heatId: number, order: number[]) => recordHeatResult(run.state, { id: 1, heatId, order, at: at(1) }, handles);
    expect(record(999, idsOf(playing))).toEqual({ ok: false, error: 'not-found' });
    expect(record(waiting.id, idsOf(waiting))).toEqual({ ok: false, error: 'not-on-station' });
    const order = idsOf(playing);
    for (const bad of [order.slice(1), [...order, 30], [order[0] as number, ...order.slice(0, -1)], [30, ...order.slice(1)]]) {
      expect(record(playing.id, bad), JSON.stringify(bad)).toEqual({ ok: false, error: 'bad-request' });
    }
    const done = expectOk(record(playing.id, order));
    expect(recordHeatResult(done.state, { id: 2, heatId: playing.id, order, at: at(2) }, handles)).toEqual({ ok: false, error: 'not-on-station' });
    expect(() => recordHeatResult(done.state, { id: 1, heatId: waiting.id, order: idsOf(waiting), at: at(2) }, handles)).toThrow();
  });

  it('refuses a tie-break with no tie at the cut', () => {
    const run = start(8, 1, { stations: 2 });
    expect(startHeatTieBreak(run.state, handles)).toEqual({ ok: false, error: 'no-tie' });
  });

  it('keeps only ids and times in the state', () => {
    const { state } = start(8, 1);
    const fields = (state: HeatState): string[] => Object.keys(state).sort();
    expect(fields(state)).toEqual(['lateJoins', 'results', 'seeding', 'settings', 'tieBreaks']);
    expect(JSON.stringify(state)).not.toMatch(/Player/);
  });
});
