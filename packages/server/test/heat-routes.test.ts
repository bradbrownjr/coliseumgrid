// The heats API through app.inject (docs/PLAN.md, "Heats API"): who may call each route, what
// each answer lists, every error, and what is stored. The engine's own rules are tested in the
// heat-*.test.ts engine files; the live message is in heat-live.test.ts, the write chain in
// heat-concurrency.test.ts, and a whole event in heat-flow.test.ts.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Heat, Heats } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { heatsSchema, nullableHeatsSchema } from '../src/api-schemas.ts';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { addPlayers, caller, makeCallers, type Api } from './bracket-api-helpers.ts';
import { expectHeatsShape, heatsBody, heatsOnStations, makeHeats, playListed, recordListed } from './heat-api-helpers.ts';
import { HOST_PASSWORD, signInHost } from './helpers.ts';

let app: FastifyInstance;
let db: Database;
let host: Api;
let display: Api;
let signup: Api;
let nobody: Api;
let ids: number[];

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = await buildApp({ db });
  ({ host, display, signup, nobody } = await makeCallers(app));
  ids = addPlayers(db, 12);
});
afterEach(() => app.close());

const make = (count: number, options: Parameters<typeof makeHeats>[2] = {}): Promise<Heats> => makeHeats(host, ids.slice(0, count), options);
const current = async (): Promise<Heats | null> => (await host('GET', '/api/heats')).json().heats;
const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const heatWith = (heats: Heats, id: number): Heat => heats.heats.find((h) => h.id === id) as Heat;

describe('who may call each route', () => {
  const hostOnly: Array<[string, string, object?]> = [
    ['POST', '/api/heats', { stations: 1, races: 1, rounds: 1, points: [4, 3, 2, 1], playerIds: [1, 2, 3, 4, 5] }],
    ['POST', '/api/heats/results', { heatId: 101, order: [1, 2] }],
    ['POST', '/api/heats/undo', { resultId: 1 }],
    ['POST', '/api/heats/players', { playerId: 1 }],
    ['POST', '/api/heats/tie-break'],
    ['POST', '/api/heats/arrived', { heatId: 101, arrived: true }],
    ['DELETE', '/api/heats'],
  ];

  it('lets the host, a Display, and a Sign-up device read the heats, and nobody else', async () => {
    for (const who of [host, display, signup]) expect((await who('GET', '/api/heats')).statusCode).toBe(200);
    const res = await nobody('GET', '/api/heats');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'not-signed-in' });
  });

  it.each(hostOnly)('%s %s answers 401 not-signed-in to a Display, a Sign-up device, and a stranger', async (method, url, payload) => {
    for (const who of [display, signup, nobody]) {
      const res = await who(method as 'GET', url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json()).toEqual({ error: 'not-signed-in' });
    }
  });

  it('changes nothing for a caller who is refused', async () => {
    for (const who of [display, signup, nobody]) await who('POST', '/api/heats', heatsBody(ids.slice(0, 5)));
    expect(await current()).toBeNull();
    expect(count('heat_runs')).toBe(0);
    // Nor can a refused caller touch heats that exist.
    await make(5);
    for (const who of [display, signup, nobody]) await who('DELETE', '/api/heats');
    expect(count('heat_runs')).toBe(1);
  });

  it('lets a host session on another machine use them, and refuses the same machine without one online', async () => {
    const other = await buildApp({ mode: 'online', hostPassword: HOST_PASSWORD });
    try {
      const remote = caller(other, await signInHost(other));
      expect((await remote('GET', '/api/heats')).statusCode).toBe(200);
      expect((await remote('DELETE', '/api/heats')).statusCode).toBe(204);
      // Online, the laptop's own address is nobody special (CLAUDE.md, rule 6).
      const local = await other.inject({ method: 'DELETE', url: '/api/heats', remoteAddress: '127.0.0.1' });
      expect(local.statusCode).toBe(401);
    } finally {
      await other.close();
    }
  });

  it('refuses a write from a page on another origin, even from the host', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/heats',
      remoteAddress: '127.0.0.1',
      headers: { origin: 'http://evil.example', host: 'localhost' },
      payload: heatsBody(ids.slice(0, 5)),
    });
    expect(res.statusCode).toBe(403);
    expect(await current()).toBeNull();
  });
});

describe('GET /api/heats', () => {
  it('answers { heats: null } before any are made', async () => {
    for (const who of [host, display, signup]) expect((await who('GET', '/api/heats')).json()).toEqual({ heats: null, now: expect.any(String) });
  });

  it('gives a Display and a Sign-up device the same answer as the host, fields only', async () => {
    await make(10);
    const answers = await Promise.all([host, display, signup].map((who) => who('GET', '/api/heats')));
    // `now` is the server's clock at each call, so only the heats are compared.
    expect(answers[1]?.json().heats).toEqual(answers[0]?.json().heats);
    expect(answers[2]?.json().heats).toEqual(answers[0]?.json().heats);
    expectHeatsShape(answers[0]?.json().heats);
  });

  it('shows a renamed handle at once, because handles are read when the answer is made', async () => {
    await make(5);
    await host('PATCH', `/api/players/${ids[0]}`, { handle: 'Renamed' });
    const heats = (await current()) as Heats;
    const handles = heats.heats.flatMap((h) => h.players.map((p) => p.handle));
    expect(handles).toContain('Renamed');
    expect(handles).not.toContain('Player1');
  });

  it('rejects a body field it does not know on every write route', async () => {
    const heats = await make(5);
    const heat = heatsOnStations(heats)[0] as Heat;
    for (const [url, body] of [
      ['/api/heats', { ...heatsBody(ids.slice(0, 5)), extra: 1 }],
      ['/api/heats/results', { heatId: heat.id, order: heat.players.map((p) => p.id), extra: 1 }],
      ['/api/heats/undo', { resultId: 1, extra: 1 }],
      ['/api/heats/players', { playerId: ids[5], extra: 1 }],
      ['/api/heats/arrived', { heatId: heat.id, arrived: true, extra: 1 }],
    ] as const) {
      const res = await host('POST', url, body);
      expect(res.statusCode, url).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
  });
});

describe('the answer schemas', () => {
  // A field added to the engine's answer must be added to the schema too, or it never leaves
  // the server (CLAUDE.md, rule 1). That only holds if no object in the schema allows extras.
  it('close every object, including the nested heat, station, standings, tie, and player shapes', () => {
    const open: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) node.forEach((n, i) => walk(n, `${path}[${i}]`));
      else if (node && typeof node === 'object') {
        const schema = node as Record<string, unknown>;
        if (schema['type'] === 'object' && schema['additionalProperties'] !== false) open.push(path);
        for (const [key, value] of Object.entries(schema)) walk(value, `${path}.${key}`);
      }
    };
    walk(heatsSchema, 'heats');
    walk(nullableHeatsSchema, 'nullable');
    expect(open).toEqual([]);
    // The heats, a heat, a player, a station, a standings row, and a tie are each listed where they are used.
    expect(JSON.stringify(heatsSchema).match(/"additionalProperties":false/g)?.length).toBeGreaterThanOrEqual(6);
  });
});

describe('POST /api/heats', () => {
  it('makes heats and answers 201 with them, called to the stations at once', async () => {
    const res = await host('POST', '/api/heats', heatsBody(ids.slice(0, 10)));
    expect(res.statusCode).toBe(201);
    const { heats } = res.json();
    expect(Object.keys(res.json()).sort()).toEqual(['heats', 'now']);
    expectHeatsShape(heats);
    expect(heats).toMatchObject({ races: 2, rounds: 2, points: [4, 3, 2, 1], finished: false, lastResultId: null, round: 1, finalSize: 4, ties: [] });
    expect(heats.stations).toHaveLength(2);
    expect(heatsOnStations(heats).map((h) => h.id)).toEqual([101, 102]);
    expect(heats.upNext.map((h: Heat) => h.id)).toEqual([103]);
    expect(heats.heats.map((h: Heat) => h.players.length)).toEqual([4, 3, 3]);
    // The same answer comes back on a read.
    expect(await current()).toEqual(heats);
  });

  it('stores ids and settings only, with every player seeded once and no handle', async () => {
    const heats = await make(7, { stations: 3, races: 3, rounds: 3, points: [10, 6, 3, 0] });
    expect(heats).toMatchObject({ races: 3, rounds: 3, points: [10, 6, 3, 0] });
    const row = db.prepare('SELECT stations, races, rounds, points, seeding FROM heat_runs').get() as Record<string, unknown>;
    expect(row).toMatchObject({ stations: 3, races: 3, rounds: 3, points: '[10,6,3,0]' });
    expect(JSON.parse(row['seeding'] as string).sort()).toEqual(ids.slice(0, 7).sort());
    await recordListed(host, heatsOnStations(heats)[0] as Heat);
    const everything = JSON.stringify(
      ['heat_runs', 'heat_results', 'heat_late_joins', 'heat_tie_breaks', 'event_players'].map((t) => db.prepare(`SELECT * FROM ${t}`).all()),
    );
    expect(everything).not.toMatch(/Player\d/);
  });

  it('seeds in an order that is not the order sent, from the server', async () => {
    // 32 players in one order: the chance a shuffle keeps it is 1 in 32!.
    const many = [...ids, ...addPlayers(db, 20, 13)];
    await makeHeats(host, many);
    const seeding = JSON.parse((db.prepare('SELECT seeding FROM heat_runs').get() as { seeding: string }).seeding) as number[];
    expect([...seeding].sort((a, b) => a - b)).toEqual(many);
    expect(seeding).not.toEqual(many);
  });

  it('takes 2 to 32 players, and stores 0 rounds with 2 to 4 so only the final is played', async () => {
    const many = [...ids, ...addPlayers(db, 24, 13)];
    expect(many).toHaveLength(36);
    const post = (n: number) => host('POST', '/api/heats', heatsBody(many.slice(0, n)));
    expect((await post(1)).json()).toEqual({ error: 'too-few-players' });
    expect((await post(0)).json()).toEqual({ error: 'too-few-players' });
    expect((await post(33)).json()).toEqual({ error: 'too-many-players' });
    expect((await post(32)).statusCode).toBe(201);
    await host('DELETE', '/api/heats');
    for (const n of [2, 3, 4]) {
      const res = await post(n);
      expect(res.statusCode, `${n} players`).toBe(201);
      expect(res.json().heats).toMatchObject({ rounds: 0, round: null, finalSize: n, lateOpen: false });
      expect(heatsOnStations(res.json().heats).map((h) => h.id)).toEqual([2000]);
      expect((db.prepare('SELECT rounds FROM heat_runs').get() as { rounds: number }).rounds).toBe(0);
      await host('DELETE', '/api/heats');
    }
    // With 5 or more, the rounds are the host's choice and are kept.
    expect((await post(5)).json().heats.rounds).toBe(2);
  });

  it.each([
    ['0 stations', { stations: 0 }],
    ['9 stations', { stations: 9 }],
    ['1.5 stations', { stations: 1.5 }],
    ['a string for stations', { stations: '2' }],
    ['0 races', { races: 0 }],
    ['5 races', { races: 5 }],
    ['4 rounds', { rounds: 4 }],
    ['negative rounds', { rounds: -1 }],
    ['0 rounds with 5 players', { rounds: 0 }],
    ['3 points', { points: [4, 3, 2] }],
    ['5 points', { points: [4, 3, 2, 1, 0] }],
    ['points that rise', { points: [1, 2, 3, 4] }],
    ['points with 0 for 1st', { points: [0, 0, 0, 0] }],
    ['points over 20', { points: [21, 3, 2, 1] }],
    ['points that are not whole numbers', { points: [4, 3, 2, 1.5] }],
    ['no points', { points: undefined }],
    ['no stations', { stations: undefined }],
  ])('answers 400 bad-request for %s', async (_name, change) => {
    const res = await host('POST', '/api/heats', { ...heatsBody(ids.slice(0, 5)), ...change });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect(await current()).toBeNull();
  });

  it.each([
    ['a player who does not exist', () => [ids[0], ids[1], 9999]],
    ['a player listed twice', () => [ids[0], ids[1], ids[1]]],
    ['a player id of 0', () => [ids[0], ids[1], 0]],
    ['a non-integer id', () => [ids[0], ids[1], 1.5]],
    ['ids that are strings', () => ['1', '2']],
  ])('answers 400 bad-request for %s', async (_name, playerIds) => {
    const res = await host('POST', '/api/heats', { ...heatsBody([]), playerIds: playerIds() });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect(await current()).toBeNull();
  });

  it('answers 409 bracket-running while heats are being played, and keeps them', async () => {
    const first = await make(5);
    const res = await host('POST', '/api/heats', heatsBody(ids.slice(0, 6)));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'bracket-running' });
    expect(await current()).toEqual(first);
  });

  it('replaces finished heats with the new ones, and removes the old rows', async () => {
    const first = await make(3);
    const done = await playListed(host, first);
    expect(done.finished).toBe(true);
    expect(count('heat_results')).toBe(1);
    const second = await make(5);
    expect(second.id).toBeGreaterThan(first.id);
    expect(second).toMatchObject({ finished: false, lastResultId: null });
    expect(count('heat_runs')).toBe(1);
    expect(count('heat_results')).toBe(0);
  });

  it('puts the heats in the current event, naming one if the host has not', async () => {
    expect((await host('GET', '/api/event')).json()).toEqual({ event: null });
    await make(5);
    expect((await host('GET', '/api/event')).json()).toEqual({ event: { name: 'ColiseumGrid', game: null, graphic: null } });
    expect(db.prepare('SELECT e.name FROM heat_runs r JOIN events e ON e.id = r.event_id').get()).toEqual({ name: 'ColiseumGrid' });
  });

  it('keeps the event the host named', async () => {
    await host('PUT', '/api/event', { name: 'Friday night' });
    await make(5);
    expect((await host('GET', '/api/event')).json()).toEqual({ event: { name: 'Friday night', game: null, graphic: null } });
    expect(count('events')).toBe(1);
  });
});

describe('POST /api/heats/results', () => {
  it('records a result, answers { heats, resultId }, and calls the next heat', async () => {
    const heats = await make(10, { stations: 1 });
    const first = heatsOnStations(heats)[0] as Heat;
    const order = first.players.map((p) => p.id).reverse();
    const res = await host('POST', '/api/heats/results', { heatId: first.id, order });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['heats', 'now', 'resultId']);
    expectHeatsShape(body.heats);
    expect(body.heats.lastResultId).toBe(body.resultId);
    const done = heatWith(body.heats, first.id);
    expect(done).toMatchObject({ status: 'done', resultId: body.resultId });
    expect(done.order?.map((p) => p.id)).toEqual(order);
    expect(heatsOnStations(body.heats)[0]?.id).not.toBe(first.id);
    expect(db.prepare('SELECT heat_id, finish_order FROM heat_results').all()).toEqual([{ heat_id: first.id, finish_order: JSON.stringify(order) }]);
  });

  it('stamps the result with the time it was recorded, and the station it freed is called then', async () => {
    const heats = await make(10, { stations: 1 });
    const before = Date.now();
    const res = await recordListed(host, heatsOnStations(heats)[0] as Heat);
    const row = db.prepare('SELECT at FROM heat_results').get() as { at: string };
    expect(Date.parse(row.at)).toBeGreaterThanOrEqual(before - 1000);
    expect(row.at).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(res.json().heats.stations[0].calledAt).toBe(row.at);
  });

  it('answers 404 no-heats when there are none, and not-found for a heat that does not exist', async () => {
    const none = await host('POST', '/api/heats/results', { heatId: 101, order: [1, 2] });
    expect(none.statusCode).toBe(404);
    expect(none.json()).toEqual({ error: 'no-heats' });
    await make(5);
    const missing = await host('POST', '/api/heats/results', { heatId: 777, order: [1, 2] });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not-found' });
  });

  it('answers 409 not-on-station for a heat that is waiting or already done', async () => {
    const heats = await make(10, { stations: 1 });
    const waiting = heats.upNext[0] as Heat;
    const res = await host('POST', '/api/heats/results', { heatId: waiting.id, order: waiting.players.map((p) => p.id) });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'not-on-station' });
    const played = heatsOnStations(heats)[0] as Heat;
    await recordListed(host, played);
    const again = await recordListed(host, played);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'not-on-station' });
    expect(count('heat_results')).toBe(1);
  });

  it('answers 400 bad-request when the order is not the heat\'s players once each, or the body is malformed', async () => {
    const heats = await make(5);
    const heat = heatsOnStations(heats)[0] as Heat;
    const players = heat.players.map((p) => p.id);
    const outsider = ids.find((id) => !players.includes(id)) as number;
    for (const body of [
      { heatId: heat.id, order: players.slice(1) },
      { heatId: heat.id, order: [...players, outsider] },
      { heatId: heat.id, order: [players[0], players[0], ...players.slice(2)] },
      { heatId: heat.id, order: [outsider, ...players.slice(1)] },
      { heatId: heat.id, order: [] },
      { heatId: heat.id, order: [...players, ...players] },
      { heatId: heat.id, order: players.map(String) },
      { heatId: heat.id },
      { heatId: -1, order: players },
      { order: players },
    ]) {
      const res = await host('POST', '/api/heats/results', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
    expect(count('heat_results')).toBe(0);
  });
});

describe('POST /api/heats/undo', () => {
  it('takes the newest result back and gives the heats exactly as they were', async () => {
    const start = await make(10, { stations: 2 });
    const first = (await recordListed(host, heatsOnStations(start)[0] as Heat)).json();
    const second = (await recordListed(host, heatsOnStations(first.heats)[0] as Heat)).json();
    const res = await host('POST', '/api/heats/undo', { resultId: second.resultId });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(['heats', 'now']);
    expect(res.json().heats).toEqual(first.heats);
    expect(await current()).toEqual(first.heats);
    expect(count('heat_results')).toBe(1);
  });

  it('keeps an older result in the log, marked undone, and moves nothing being played', async () => {
    const start = await make(10, { stations: 2 });
    const [a, b] = heatsOnStations(start) as [Heat, Heat];
    const first = (await recordListed(host, a)).json();
    const second = (await recordListed(host, b)).json();
    // 103 is on a station now, and the other station is idle: 101 can reopen into it.
    const onStation = heatsOnStations(second.heats).map((h) => [h.id, second.heats.stations.findIndex((s: { heat: Heat | null }) => s.heat?.id === h.id)]);
    const res = await host('POST', '/api/heats/undo', { resultId: first.resultId });
    expect(res.statusCode, res.body).toBe(200);
    const after = res.json().heats as Heats;
    for (const [id, index] of onStation as Array<[number, number]>) expect(after.stations[index]?.heat?.id).toBe(id);
    expect(heatWith(after, a.id)).toMatchObject({ status: 'playing', order: null, resultId: null });
    expect(after.lastResultId).toBe(second.resultId);
    expect(db.prepare('SELECT id, undone_step IS NOT NULL AS undone FROM heat_results ORDER BY id').all()).toEqual([
      { id: first.resultId, undone: 1 },
      { id: second.resultId, undone: 0 },
    ]);
    // Undoing it a second time finds nothing to undo.
    const again = await host('POST', '/api/heats/undo', { resultId: first.resultId });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'nothing-to-undo' });
  });

  it('never gives an undone result id to a later result', async () => {
    const start = await make(5, { stations: 1 });
    const first = (await recordListed(host, heatsOnStations(start)[0] as Heat)).json();
    await host('POST', '/api/heats/undo', { resultId: first.resultId });
    const again = (await recordListed(host, heatsOnStations((await current()) as Heats)[0] as Heat)).json();
    expect(again.resultId).toBeGreaterThan(first.resultId);
    // A screen still holding the old id can't take back the new result.
    const stale = await host('POST', '/api/heats/undo', { resultId: first.resultId });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'nothing-to-undo' });
  });

  it('answers 409 nothing-to-undo for a result that is not in the log, and 404 no-heats with no heats', async () => {
    const none = await host('POST', '/api/heats/undo', { resultId: 1 });
    expect(none.statusCode).toBe(404);
    expect(none.json()).toEqual({ error: 'no-heats' });
    await make(5);
    const missing = await host('POST', '/api/heats/undo', { resultId: 42 });
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toEqual({ error: 'nothing-to-undo' });
  });

  it('answers 409 undo-later-first when a later round was made from the older result, and changes nothing', async () => {
    // 5 players are heats of 3 and 2. Both results make round 2 from the points they gave.
    const start = await make(5, { stations: 2 });
    const [a, b] = heatsOnStations(start) as [Heat, Heat];
    const first = (await recordListed(host, a)).json();
    const second = (await recordListed(host, b)).json();
    expect(second.heats.heats.some((h: Heat) => h.round === 2)).toBe(true);
    const res = await host('POST', '/api/heats/undo', { resultId: first.resultId });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'undo-later-first' });
    expect(await current()).toEqual(second.heats);
    expect(count('heat_results')).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM heat_results WHERE undone_step IS NOT NULL').get()).toEqual({ n: 0 });
  });

  it('answers 400 bad-request for a body that is not a result id', async () => {
    await make(5);
    for (const body of [{}, { resultId: 0 }, { resultId: 'x' }]) {
      const res = await host('POST', '/api/heats/undo', body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
  });
});

describe('POST /api/heats/players', () => {
  it('puts a late player in the smallest waiting round 1 heat, and stores the join', async () => {
    const start = await make(10, { stations: 2 });
    expect(start.lateOpen).toBe(true);
    const res = await host('POST', '/api/heats/players', { playerId: ids[10] });
    expect(res.statusCode, res.body).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(['heats', 'now']);
    expectHeatsShape(res.json().heats);
    expect(res.json().heats.lateOpen).toBe(false);
    expect(heatWith(res.json().heats, 103).players.map((p) => p.id)).toContain(ids[10]);
    expect(db.prepare('SELECT player_id, heat_id, step FROM heat_late_joins').all()).toEqual([{ player_id: ids[10], heat_id: 103, step: 0 }]);
    // The seeding is the on-time players only.
    const seeding = JSON.parse((db.prepare('SELECT seeding FROM heat_runs').get() as { seeding: string }).seeding) as number[];
    expect(seeding).not.toContain(ids[10]);
  });

  it('answers 409 already-in for a player who is in the heats', async () => {
    await make(10);
    const res = await host('POST', '/api/heats/players', { playerId: ids[0] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'already-in' });
  });

  it('answers 409 late-closed when every heat is called, or full, and once round 1 is finished', async () => {
    // Two stations and two heats: both are called at the start.
    await make(6, { stations: 2 });
    const closed = await host('POST', '/api/heats/players', { playerId: ids[6] });
    expect(closed.statusCode).toBe(409);
    expect(closed.json()).toEqual({ error: 'late-closed' });
    expect(((await current()) as Heats).lateOpen).toBe(false);
    // With 2 to 4 players the one heat is the final, so there is no late sign-up.
    await host('DELETE', '/api/heats');
    await make(4);
    expect((await host('POST', '/api/heats/players', { playerId: ids[4] })).json()).toEqual({ error: 'late-closed' });
  });

  it('answers 404 not-found for a player who does not exist, and no-heats when there are none', async () => {
    const none = await host('POST', '/api/heats/players', { playerId: ids[0] });
    expect(none.statusCode).toBe(404);
    expect(none.json()).toEqual({ error: 'no-heats' });
    await make(10);
    const missing = await host('POST', '/api/heats/players', { playerId: 9999 });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not-found' });
  });

  it('answers 400 bad-request for a body that is not a player id', async () => {
    await make(10);
    for (const body of [{}, { playerId: 0 }, { playerId: 'a' }]) {
      expect((await host('POST', '/api/heats/players', body)).statusCode).toBe(400);
    }
  });
});

describe('POST /api/heats/tie-break', () => {
  it('answers 409 no-tie when no tie waits, and 404 no-heats when there are none', async () => {
    const none = await host('POST', '/api/heats/tie-break');
    expect(none.statusCode).toBe(404);
    expect(none.json()).toEqual({ error: 'no-heats' });
    await make(10);
    const res = await host('POST', '/api/heats/tie-break');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'no-tie' });
    expect(count('heat_tie_breaks')).toBe(0);
  });
});

describe('DELETE /api/heats', () => {
  it('removes the heats and all their rows, and answers 204 with no body', async () => {
    const start = await make(10, { stations: 2 });
    await recordListed(host, heatsOnStations(start)[0] as Heat);
    await host('POST', '/api/heats/players', { playerId: ids[10] });
    const res = await host('DELETE', '/api/heats');
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(await current()).toBeNull();
    for (const table of ['heat_runs', 'heat_results', 'heat_late_joins', 'heat_tie_breaks']) {
      expect(count(table), table).toBe(0);
    }
  });

  it('answers 204 again when there is nothing to delete, and lets new heats start at once', async () => {
    expect((await host('DELETE', '/api/heats')).statusCode).toBe(204);
    await make(5);
    expect((await host('DELETE', '/api/heats')).statusCode).toBe(204);
    expect((await host('DELETE', '/api/heats')).statusCode).toBe(204);
    expect((await host('POST', '/api/heats', heatsBody(ids.slice(0, 5)))).statusCode).toBe(201);
  });
});

describe('heats survive a restart exactly', () => {
  it('reads back the same answer from the file after the app is rebuilt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coliseumgrid-heats-'));
    try {
      const file = join(dir, 'test.db');
      const first = await buildApp({ db: openDatabase(file), hostPassword: HOST_PASSWORD });
      const api = caller(first, await signInHost(first));
      for (const handle of ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7']) {
        expect((await api('POST', '/api/players', { handle })).statusCode).toBe(201);
      }
      const all = ((await api('GET', '/api/players')).json().players as { id: number }[]).map((p) => p.id);
      let heats = (await api('POST', '/api/heats', heatsBody(all, { stations: 2 }))).json().heats as Heats;
      for (let i = 0; i < 2; i++) {
        const res = await api('POST', '/api/heats/results', {
          heatId: (heatsOnStations(heats)[0] as Heat).id,
          order: (heatsOnStations(heats)[0] as Heat).players.map((p) => p.id).reverse(),
        });
        expect(res.statusCode, res.body).toBe(200);
        heats = res.json().heats;
      }
      // One undo, so the stored rows have been rewritten as well as added to.
      heats = (await api('POST', '/api/heats/undo', { resultId: heats.lastResultId })).json().heats;
      await first.close();

      const second = await buildApp({ db: openDatabase(file), hostPassword: HOST_PASSWORD });
      const again = caller(second, await signInHost(second));
      expect((await again('GET', '/api/heats')).json().heats).toEqual(heats);
      await second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
