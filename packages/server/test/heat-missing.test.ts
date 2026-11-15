// A group with a missing player (docs/PLAN.md, "Waiting for a missing player"): the player
// scores 0 points, the group counts as played for them, and in the final or a tie-break group
// they take the places after those who played. It is logged, replayed, and undone like any
// result, and the answer lists who was missing.

import { createSeededRandom, shuffle, type Heat, type Heats } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { heatsAnswer, recordHeatResult, startHeatTieBreak } from '../src/heat-engine.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { buildApp } from '../src/app.ts';
import { createHeatStore } from '../src/heat-store.ts';
import { addPlayers, makeCallers, type Api } from './bracket-api-helpers.ts';
import { expectHeatsShape, makeHeats } from './heat-api-helpers.ts';
import { at, expectOk, handles, listedPick, onStations, play, start, undo, type HeatRun } from './heat-helpers.ts';

const heat = (heats: Heats, id: number): Heat => heats.heats.find((h) => h.id === id) as Heat;
const idsOf = (players: Array<{ id: number }>): number[] => players.map((p) => p.id);
const playListed = (run: HeatRun, id: number, missing: number[] = []): HeatRun => {
  const listed = listedPick(heat(run.heats, id));
  return play(run, heat(run.heats, id), listed.filter((p) => !missing.includes(p)), missing);
};
const standingsOf = (heats: Heats) => heats.standings.map((r) => [r.player.id, r.place, r.points, r.heatsPlayed]);

/** Undoes the newest result and checks the answer and the state are exactly the earlier ones. */
function expectUndoRestores(before: HeatRun, after: HeatRun): void {
  const undone = expectOk(undo(after.state, after.state.results.at(-1)?.id as number));
  expect(undone.heats).toEqual(before.heats);
  expect(undone.state).toEqual(before.state);
}

describe('a missing player in a qualifying group', () => {
  it('scores 0 points, counts the group as played, and lets the others take places 1, 2, and so on', () => {
    // 8 players, two groups of 4, 2 stations: both are on at the start.
    const run = start(8, 8, { stations: 2, rounds: 1 });
    const first = heat(run.heats, 101);
    const [a, b, c, d] = idsOf(first.players) as [number, number, number, number];
    // c is missing; the order is a, b, d. They take 4 and 3 points and 2 for 3rd place.
    const played = play(run, first, [a, b, d], [c]);

    expect(heat(played.heats, 101)).toMatchObject({ status: 'done', order: [a, b, d].map((id) => ({ id })), missing: [{ id: c }] });
    const row = (id: number) => played.heats.standings.find((r) => r.player.id === id);
    expect([a, b, d, c].map((id) => row(id)?.points)).toEqual([4, 3, 2, 0]);
    expect([a, b, d, c].map((id) => row(id)?.heatsPlayed)).toEqual([1, 1, 1, 1]);
    expectHeatsShape(played.heats);
  });

  it('leaves `missing` empty on a heat with no result and on one where everyone came', () => {
    const run = start(8, 8, { stations: 2, rounds: 1 });
    expect(run.heats.heats.every((h) => h.missing.length === 0)).toBe(true);
    const played = playListed(run, 101);
    expect(heat(played.heats, 101).missing).toEqual([]);
    expect('missing' in (played.state.results[0] as object)).toBe(false);
  });

  it('lets one player be the only one who came, who takes 1st', () => {
    const run = start(8, 8, { stations: 2, rounds: 1 });
    const first = heat(run.heats, 101);
    const [a, ...rest] = idsOf(first.players) as [number, ...number[]];
    const played = play(run, first, [a], rest);
    expect(played.heats.standings.find((r) => r.player.id === a)?.points).toBe(4);
    for (const id of rest) expect(played.heats.standings.find((r) => r.player.id === id)).toMatchObject({ points: 0, heatsPlayed: 1 });
  });

  it('gives everyone the same number of groups played, so a finished event counts every round for everyone', () => {
    const random = createSeededRandom(9);
    let run = start(12, 12, { stations: 2, rounds: 2 });
    for (;;) {
      const live = onStations(run.heats);
      if (live.length === 0) {
        if (!run.heats.ties.some((t) => !t.started)) break;
        run = expectOk(startHeatTieBreak(run.state, handles));
        continue;
      }
      const target = live[0] as Heat;
      const players = shuffle(idsOf(target.players), random);
      // One player in every other group is missing.
      const missing = target.number % 2 === 0 ? [players.pop() as number] : [];
      run = play(run, target, players, missing);
    }
    expect(run.heats.finished).toBe(true);
    for (const row of run.heats.standings) expect(row.heatsPlayed, row.player.handle).toBe(2);
    const places = run.heats.standings.map((r) => r.place);
    expect(places.slice(0, 3)).toEqual([1, 2, 3]);
  });
});

describe('a missing player in the final', () => {
  it('takes the places after those who played, in qualifying order, so places 1 to 3 stay unique', () => {
    let run = start(8, 8, { stations: 2, rounds: 1 });
    run = playListed(playListed(run, 101), 102);
    const qualifying = idsOf(run.heats.standings.map((r) => r.player)).slice(0, 4);
    expect(run.heats.heats.find((h) => h.kind === 'final')?.players.map((p) => p.id)).toEqual(qualifying);

    // Only the last of the four came. The other three follow in qualifying order.
    const final = heat(run.heats, 2000);
    const came = qualifying[3] as number;
    const done = play(run, final, [came], qualifying.slice(0, 3));
    expect(done.heats.finished).toBe(true);
    expect(done.heats.standings.slice(0, 4).map((r) => [r.place, r.player.id])).toEqual([
      [1, came],
      [2, qualifying[0]],
      [3, qualifying[1]],
      [4, qualifying[2]],
    ]);
    expect(heat(done.heats, 2000)).toMatchObject({ order: [{ id: came }], missing: qualifying.slice(0, 3).map((id) => ({ id })) });
    expectUndoRestores(run, done);
  });

  it('puts a missing player behind the rest in seeding order when 2 to 4 players play only the final', () => {
    const run = start(4, 4, { stations: 1 });
    const seeding = run.state.seeding;
    const final = heat(run.heats, 2000);
    const done = play(run, final, [seeding[2] as number], [seeding[0] as number, seeding[1] as number, seeding[3] as number]);
    expect(done.heats.standings.map((r) => [r.place, r.player.id])).toEqual([
      [1, seeding[2]],
      [2, seeding[0]],
      [3, seeding[1]],
      [4, seeding[3]],
    ]);
  });
});

describe('a missing player in a tie-break group', () => {
  /** 12 players, a tie of 9 at the cut, split into three tie-break groups of 3 (heat-undo.test.ts). */
  function tied(): HeatRun {
    let run = start(12, 12, { stations: 2, rounds: 1, points: [1, 0, 0, 0] });
    for (const id of [101, 102, 103]) run = playListed(run, id);
    return expectOk(startHeatTieBreak(run.state, handles));
  }

  it('takes the places after those who played, and the event still finishes with places 1 to 3 held once', () => {
    let run = tied();
    const tieBreak = heat(run.heats, 1000);
    const [x, y, z] = idsOf(tieBreak.players) as [number, number, number];
    run = play(run, tieBreak, [y], [x, z]);
    expect(heat(run.heats, 1000)).toMatchObject({ order: [{ id: y }], missing: [{ id: x }, { id: z }] });
    run = playListed(run, 1001);
    run = playListed(run, 1002);
    // A pass can leave players level across the cut, which needs another pass.
    for (;;) {
      const live = onStations(run.heats)[0];
      if (live) run = playListed(run, live.id);
      else if (run.heats.ties.some((t) => !t.started)) run = expectOk(startHeatTieBreak(run.state, handles));
      else break;
    }
    expect(run.heats.finished).toBe(true);
    const places = run.heats.standings.map((r) => r.place);
    for (const place of [1, 2, 3]) expect(places.filter((p) => p === place), `place ${place}`).toHaveLength(1);
  });

  it('restores the answer exactly when the result with a missing player is undone', () => {
    const before = tied();
    const tieBreak = heat(before.heats, 1000);
    const [x, y, z] = idsOf(tieBreak.players) as [number, number, number];
    expectUndoRestores(before, play(before, tieBreak, [y], [x, z]));
  });
});

describe('refusals', () => {
  it('refuses order and missing together that are not the heat\'s players once each, or nobody who came', () => {
    const run = start(8, 8, { stations: 2, rounds: 1 });
    const first = heat(run.heats, 101);
    const [a, b, c, d] = idsOf(first.players) as [number, number, number, number];
    const stranger = idsOf(heat(run.heats, 102).players)[0] as number;
    const bad: Array<[string, number[], number[]]> = [
      ['nobody came', [], [a, b, c, d]],
      ['a player left out', [a, b], [c]],
      ['a player in both lists', [a, b, c], [c, d]],
      ['a player twice in order', [a, a, b], [c, d]],
      ['a player twice in missing', [a, b], [c, c, d]],
      ['a stranger in missing', [a, b, c], [stranger]],
      ['a stranger in order', [a, b, stranger], [c, d]],
    ];
    for (const [label, order, missing] of bad) {
      expect(recordHeatResult(run.state, { id: 1, heatId: 101, order, missing, at: at(1) }, handles), label).toEqual({ ok: false, error: 'bad-request' });
    }
  });
});

describe('undo of a result with a missing player', () => {
  it('restores the answer and the state exactly after every result in a whole event, whoever is missing', () => {
    let checks = 0;
    for (const [n, rounds] of [[5, 2], [8, 1], [12, 2], [13, 3]] as const) {
      const random = createSeededRandom(n * 3 + rounds);
      let run = start(n, n + rounds, { stations: 1 + (n % 3), rounds });
      for (;;) {
        const live = onStations(run.heats);
        if (live.length === 0) {
          if (!run.heats.ties.some((t) => !t.started)) break;
          run = expectOk(startHeatTieBreak(run.state, handles));
          continue;
        }
        const target = live[Math.floor(random() * live.length)] as Heat;
        const players = shuffle(idsOf(target.players), random);
        // Half the results lose one or two players (always leaving one who came).
        const lost = random() < 0.5 ? Math.min(players.length - 1, 1 + Math.floor(random() * 2)) : 0;
        const missing = players.splice(players.length - lost, lost);
        const next = play(run, target, players, missing);
        expectUndoRestores(run, next);
        checks++;
        run = next;
      }
      expect(run.heats.finished).toBe(true);
    }
    expect(checks).toBeGreaterThan(20);
  });

  it('takes an older result with a missing player back: the group opens again, and the standings are as if it never happened', () => {
    // 12 players in three groups of 4 on 2 stations: 101 (a missing player), then 102.
    const run = start(12, 12, { stations: 2, rounds: 2 });
    const first = heat(run.heats, 101);
    const missing = [idsOf(first.players)[3] as number];
    const afterA = play(run, first, idsOf(first.players).slice(0, 3), missing);
    const afterB = playListed(afterA, 102);
    const undone = expectOk(undo(afterB.state, afterA.state.results[0]?.id as number));

    expect(heat(undone.heats, 101)).toMatchObject({ order: null, missing: [], resultId: null });
    expect(heat(undone.heats, 101).status).not.toBe('done');
    // The result stays in the log with its marks, undone.
    expect(undone.state.results[0]).toMatchObject({ missing, undone: { step: 2 } });
    const onlyB = playListed(run, 102);
    expect(standingsOf(undone.heats)).toEqual(standingsOf(onlyB.heats));
    // Played again, with nobody missing this time, it scores everyone.
    const again = playListed(undone, 101);
    expect(again.heats.standings.find((r) => r.player.id === missing[0])?.heatsPlayed).toBe(1);
  });
});

describe('the heat store with missing players', () => {
  let db: Database;
  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('loads exactly the state it saved, missing lists and an undone one included, and the answer is the same', () => {
    const store = createHeatStore(db);
    const eventId = Number(db.prepare("INSERT INTO events (name, created_at) VALUES ('Friday', 't')").run().lastInsertRowid);
    const run = start(12, 12, { stations: 2, rounds: 2 });
    const first = heat(run.heats, 101);
    const afterA = play(run, first, idsOf(first.players).slice(0, 2), idsOf(first.players).slice(2));
    const afterB = playListed(afterA, 102);
    const undone = expectOk(undo(afterB.state, afterA.state.results[0]?.id as number));
    for (const state of [afterA.state, afterB.state, undone.state]) {
      store.save(eventId, state);
      const loaded = store.load(eventId);
      expect(loaded).toEqual(state);
      expect(heatsAnswer(loaded as typeof state, handles)).toEqual(heatsAnswer(state, handles));
    }
    expect(db.prepare('SELECT missing FROM heat_results ORDER BY id').all()).toEqual([{ missing: JSON.stringify(idsOf(first.players).slice(2)) }, { missing: null }]);
  });
});

describe('POST /api/heats/results with missing', () => {
  let app: FastifyInstance;
  let host: Api;
  let ids: number[];
  beforeEach(async () => {
    const db = openDatabase(':memory:');
    app = await buildApp({ db });
    ({ host } = await makeCallers(app));
    ids = addPlayers(db, 8);
  });
  afterEach(() => app.close());

  it('records who didn\'t come, answers with them in `missing`, and takes the result back', async () => {
    const heats = await makeHeats(host, ids, { stations: 2, rounds: 1 });
    const first = heat(heats, 101);
    const [a, b, c, d] = idsOf(first.players) as [number, number, number, number];
    const res = await host('POST', '/api/heats/results', { heatId: 101, order: [a, b, c], missing: [d] });
    expect(res.statusCode, res.body).toBe(200);
    expectHeatsShape(res.json().heats);
    expect(heat(res.json().heats, 101).missing).toEqual([{ id: d, handle: expect.any(String) }]);

    const undone = await host('POST', '/api/heats/undo', { resultId: res.json().resultId });
    expect(undone.statusCode).toBe(200);
    expect(heat(undone.json().heats, 101)).toMatchObject({ status: 'playing', missing: [], order: null });
  });

  it('answers 400 bad-request for order and missing that are not the group once each, and for a body with another field', async () => {
    const heats = await makeHeats(host, ids, { stations: 2, rounds: 1 });
    const [a, b, c, d] = idsOf(heat(heats, 101).players) as [number, number, number, number];
    const bodies: object[] = [
      { heatId: 101, order: [], missing: [a, b, c, d] },
      { heatId: 101, order: [a, b], missing: [c] },
      { heatId: 101, order: [a, b, c], missing: [c, d] },
      { heatId: 101, order: [a, b, c], missing: 'd' },
      { heatId: 101, order: [a, b, c], missing: [d], extra: true },
      { heatId: 101, order: [a, b, c, d], missing: [a, b, c, d, a] },
    ];
    for (const body of bodies) {
      const res = await host('POST', '/api/heats/results', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
    // Nothing was stored, and `missing: []` is the same as leaving it out.
    const ok = await host('POST', '/api/heats/results', { heatId: 101, order: [a, b, c, d], missing: [] });
    expect(ok.statusCode).toBe(200);
    expect(heat(ok.json().heats, 101).missing).toEqual([]);
  });
});
