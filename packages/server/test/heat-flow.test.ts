// A whole event played through the routes: 10 players and a late one, every group recorded to
// a three-way tie at the cut, an older undo and a newest undo along the way, the tie-break, the
// final, and the finish (docs/PLAN.md, "Heats API"). The engine's rules are tested at every
// size in the heat-*.test.ts files; this checks the routes carry them whole.
//
// Every heat is recorded with its players in the listed order. The seeding is random, but the
// points the first two rounds hand out depend only on the places in a heat, so the tie across
// the cut for the final comes out the same for any seed (checked over 1000 seeds).

import type { Heat, Heats } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { addPlayers, makeCallers, type Api } from './bracket-api-helpers.ts';
import { expectHeatsShape, heatsBody, heatsOnStations, playListed, recordListed } from './heat-api-helpers.ts';

let app: FastifyInstance;
let db: Database;
let host: Api;
let ids: number[];

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = await buildApp({ db });
  ({ host } = await makeCallers(app));
  ids = addPlayers(db, 12);
});
afterEach(() => app.close());

const get = async (): Promise<Heats> => (await host('GET', '/api/heats')).json().heats;
const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const stationOf = (heats: Heats, id: number): number => heats.stations.findIndex((s) => s.heat?.id === id);

async function record(heat: Heat): Promise<{ heats: Heats; resultId: number }> {
  const res = await recordListed(host, heat);
  expect(res.statusCode, res.body).toBe(200);
  expectHeatsShape(res.json().heats);
  return res.json();
}

describe('heats through the routes', () => {
  it('takes a late player, both kinds of undo, a three-way tie at the cut, its tie-break, and the final, then finishes', async () => {
    const created = await host('POST', '/api/heats', heatsBody(ids.slice(0, 10), { stations: 2, races: 2, rounds: 2 }));
    expect(created.statusCode).toBe(201);
    let heats = created.json().heats as Heats;
    expectHeatsShape(heats);
    expect(heats).toMatchObject({ round: 1, lateOpen: true, finalSize: 4 });
    expect(heatsOnStations(heats).map((h) => h.id)).toEqual([101, 102]);

    // The 11th player joins the heat still waiting (103), before it is called; then none is left.
    const late = await host('POST', '/api/heats/players', { playerId: ids[10] });
    expect(late.statusCode, late.body).toBe(200);
    heats = late.json().heats;
    expect(heats.lateOpen).toBe(false);
    expect(heats.heats.find((h) => h.id === 103)?.players.map((p) => p.id)).toContain(ids[10]);
    expect(heats.heats.map((h) => h.players.length)).toEqual([4, 3, 4]);
    expect((await host('POST', '/api/heats/players', { playerId: ids[10] })).json()).toEqual({ error: 'already-in' });
    expect((await host('POST', '/api/heats/players', { playerId: ids[11] })).json()).toEqual({ error: 'late-closed' });

    // Heats 101 and 102 are recorded. 103 takes the station 101 freed.
    const first = await record(heatsOnStations(heats)[0] as Heat);
    const second = await record(heatsOnStations(first.heats).find((h) => h.id === 102) as Heat);
    expect(heatsOnStations(second.heats).map((h) => h.id)).toEqual([103]);
    const beforeOlder = second.heats;

    // The older undo reopens 101 on the idle station and moves nothing being played.
    const older = await host('POST', '/api/heats/undo', { resultId: first.resultId });
    expect(older.statusCode, older.body).toBe(200);
    heats = older.json().heats;
    expect(stationOf(heats, 103)).toBe(stationOf(beforeOlder, 103));
    expect(heats.heats.find((h) => h.id === 101)).toMatchObject({ status: 'playing', order: null, resultId: null });
    expect(heats.stations.find((s) => s.heat?.id === 103)?.calledAt).toBe(beforeOlder.stations.find((s) => s.heat?.id === 103)?.calledAt);
    expect(db.prepare('SELECT COUNT(*) AS n FROM heat_results WHERE undone_step IS NOT NULL').get()).toEqual({ n: 1 });

    // 101 is recorded again, and that newest result is taken back: the heats are exactly as they were.
    const again = await record(heats.heats.find((h) => h.id === 101) as Heat);
    const newest = await host('POST', '/api/heats/undo', { resultId: again.resultId });
    expect(newest.statusCode, newest.body).toBe(200);
    expect(newest.json().heats).toEqual(heats);
    expect(await get()).toEqual(heats);
    const third = await record(heats.heats.find((h) => h.id === 101) as Heat);
    expect(third.resultId).toBeGreaterThan(again.resultId);

    // Everything else is played in the listed order. Round 2 is made once round 1 is done,
    // and no heat is left to play with a three-way tie across the cut for the final.
    heats = await playListed(host, third.heats);
    expectHeatsShape(heats);
    expect(heats.heats.filter((h) => h.round === 2).map((h) => h.players.length)).toEqual([4, 4, 3]);
    expect(heats.finished).toBe(false);
    expect(heats.round).toBeNull();
    expect(heats.ties).toEqual([{ place: 4, players: expect.any(Array), started: false }]);
    expect(heats.ties[0]?.players).toHaveLength(3);
    expect(heats.heats.some((h) => h.kind === 'tie-break' || h.kind === 'final')).toBe(false);
    expect(heatsOnStations(heats)).toEqual([]);
    expect(await get()).toEqual(heats);

    // "Play tie-break" makes the heat; asking again has nothing to make.
    const made = await host('POST', '/api/heats/tie-break');
    expect(made.statusCode, made.body).toBe(200);
    expectHeatsShape(made.json().heats);
    heats = made.json().heats;
    expect(heats.ties[0]?.started).toBe(true);
    const tieBreaks = heats.heats.filter((h) => h.kind === 'tie-break');
    expect(tieBreaks.map((h) => [h.id, h.players.length])).toEqual([[1000, 3]]);
    expect(heatsOnStations(heats).map((h) => h.id)).toEqual([1000]);
    expect(count('heat_tie_breaks')).toBe(1);
    const noMore = await host('POST', '/api/heats/tie-break');
    expect(noMore.statusCode).toBe(409);
    expect(noMore.json()).toEqual({ error: 'no-tie' });

    // A result from before the tie-break can't come off while the tie-break was made from it.
    const oldest = heats.heats.find((h) => h.id === 102) as Heat;
    const refused = await host('POST', '/api/heats/undo', { resultId: oldest.resultId });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'undo-later-first' });
    expect(await get()).toEqual(heats);

    // The tie-break is played, which makes the final of the top four.
    const tie = await record(tieBreaks[0] as Heat);
    heats = tie.heats;
    expect(heats.ties).toEqual([]);
    const final = heats.heats.find((h) => h.kind === 'final') as Heat;
    expect(final).toMatchObject({ id: 2000, round: 1, number: 1, status: 'playing' });
    expect(final.players).toHaveLength(4);
    expect(heatsOnStations(heats).map((h) => h.id)).toEqual([2000]);

    const done = await record(final);
    heats = done.heats;
    expect(heats.finished).toBe(true);
    expect(heats.ties).toEqual([]);
    expect(heats.lateOpen).toBe(false);
    expect(heats.stations.every((s) => s.heat === null)).toBe(true);
    expect(heats.upNext).toEqual([]);
    expect(heats.lastResultId).toBe(done.resultId);

    // The podium is the final's order, and all 11 players are placed once, each with 2 heats.
    const finalOrder = (heats.heats.find((h) => h.kind === 'final') as Heat).order?.map((p) => p.id);
    expect(heats.standings.slice(0, 4).map((r) => [r.place, r.player.id])).toEqual((finalOrder ?? []).map((id, i) => [i + 1, id]));
    expect(heats.standings).toHaveLength(11);
    expect(new Set(heats.standings.map((r) => r.player.id))).toEqual(new Set(ids.slice(0, 11)));
    expect(heats.standings.every((r) => r.heatsPlayed === 2)).toBe(true);
    expect(heats.heats.every((h) => h.status === 'done')).toBe(true);
    expect(heats.heats.map((h) => h.id)).toEqual([101, 102, 103, 201, 202, 203, 1000, 2000]);

    // Finished heats can't take a late player, and the database holds exactly what the answer was made from.
    expect((await host('POST', '/api/heats/players', { playerId: ids[11] })).json()).toEqual({ error: 'late-closed' });
    expect(await get()).toEqual(heats);
    expect(count('heat_results')).toBe(8 + 1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM heat_results WHERE undone_step IS NOT NULL').get()).toEqual({ n: 1 });
    expect(count('heat_late_joins')).toBe(1);

    // Delete it, and new heats can start at once.
    expect((await host('DELETE', '/api/heats')).statusCode).toBe(204);
    expect(await get()).toBeNull();
    expect((await host('POST', '/api/heats', heatsBody(ids.slice(0, 5)))).statusCode).toBe(201);
  });

  it.each([2, 3, 4])('plays %s players straight to the final, which finishes the event', async (n) => {
    const created = await host('POST', '/api/heats', heatsBody(ids.slice(0, n)));
    expect(created.statusCode).toBe(201);
    const heats = created.json().heats as Heats;
    expect(heats).toMatchObject({ rounds: 0, round: null, finalSize: n, lateOpen: false });
    expect(heats.heats.map((h) => [h.id, h.kind])).toEqual([[2000, 'final']]);
    const final = heatsOnStations(heats)[0] as Heat;
    const done = (await record(final)).heats;
    expect(done.finished).toBe(true);
    expect(done.standings.map((r) => [r.place, r.player.id])).toEqual(final.players.map((p, i) => [i + 1, p.id]));
    expect(done.standings.every((r) => r.points === 0 && r.heatsPlayed === 0)).toBe(true);
  });

  it('plays 32 players over 3 rounds on 8 stations to a finish', async () => {
    const many = [...ids, ...addPlayers(db, 20, 13)];
    const created = await host('POST', '/api/heats', heatsBody(many, { stations: 8, races: 4, rounds: 3, points: [20, 10, 5, 0] }));
    expect(created.statusCode, created.body).toBe(201);
    let heats = created.json().heats as Heats;
    expect(heatsOnStations(heats)).toHaveLength(8);
    for (let guard = 0; guard < 20 && !heats.finished; guard++) {
      heats = await playListed(host, heats);
      if (heats.ties.some((t) => !t.started)) {
        const res = await host('POST', '/api/heats/tie-break');
        expect(res.statusCode, res.body).toBe(200);
        heats = res.json().heats;
      }
    }
    expect(heats.finished).toBe(true);
    expect(heats.standings).toHaveLength(32);
    expect(heats.standings.every((r) => r.heatsPlayed === 3)).toBe(true);
    expect(await get()).toEqual(heats);
  });
});
