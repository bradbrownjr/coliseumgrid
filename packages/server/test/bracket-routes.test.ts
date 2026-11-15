// The brackets API through app.inject (docs/PLAN.md, "Brackets API"): who may call each route,
// what each answer lists, every error, and what is stored. The engine's own rules are tested in
// the bracket-*.test.ts files; the live message is in bracket-live.test.ts and the write chain
// in write-chain.test.ts and bracket-concurrency.test.ts.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bracket, BracketFormat } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bracketSchema, nullableBracketSchema } from '../src/api-schemas.ts';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { addPlayers, caller, expectContractShape, makeCallers, onStations, type Api } from './bracket-api-helpers.ts';
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
  ids = addPlayers(db, 8);
});
afterEach(() => app.close());

const make = async (format: BracketFormat, count: number, stations = 2, bestOf = 1): Promise<Bracket> => {
  const res = await host('POST', '/api/bracket', { format, bestOf, stations, playerIds: ids.slice(0, count) });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().bracket;
};

const current = async (): Promise<Bracket | null> => (await host('GET', '/api/bracket')).json().bracket;

/** Records a win for the player in `slot` of a match on a station. */
async function win(bracket: Bracket, which: number, slot: 0 | 1) {
  const match = onStations(bracket)[which];
  if (!match) throw new Error('no match on that station');
  return host('POST', '/api/bracket/results', { matchId: match.id, winnerId: match.slots[slot].player?.id });
}

/** Plays a bracket to its finish, the player in `slot` winning each match. */
async function playOut(bracket: Bracket, slot: 0 | 1): Promise<Bracket> {
  let now = bracket;
  for (let guard = 0; guard < 100 && !now.finished; guard++) {
    const res = await win(now, 0, slot);
    expect(res.statusCode, res.body).toBe(200);
    now = res.json().bracket;
  }
  expect(now.finished).toBe(true);
  return now;
}

describe('who may call each route', () => {
  const hostOnly: Array<[string, string, object?]> = [
    ['POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: [1, 2] }],
    ['POST', '/api/bracket/results', { matchId: 0, winnerId: 1 }],
    ['POST', '/api/bracket/undo', { resultId: 1 }],
    ['POST', '/api/bracket/players', { playerId: 1 }],
    ['POST', '/api/bracket/tie-break'],
    ['DELETE', '/api/bracket'],
    ['GET', '/api/event/players'],
  ];

  it('lets the host, a Display, and a Sign-up device read the bracket, and nobody else', async () => {
    for (const who of [host, display, signup]) expect((await who('GET', '/api/bracket')).statusCode).toBe(200);
    const res = await nobody('GET', '/api/bracket');
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
    for (const who of [display, signup, nobody]) {
      await who('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 4) });
    }
    expect(await current()).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM brackets').get()).toEqual({ n: 0 });
  });

  it('lets a host session on another machine use them, and refuses the same machine without one online', async () => {
    const other = await buildApp({ mode: 'online', hostPassword: HOST_PASSWORD });
    try {
      const remote = caller(other, await signInHost(other));
      expect((await remote('GET', '/api/bracket')).statusCode).toBe(200);
      expect((await remote('GET', '/api/event/players')).statusCode).toBe(200);
      expect((await remote('DELETE', '/api/bracket')).statusCode).toBe(204);
      // Online, the laptop's own address is nobody special (CLAUDE.md, rule 6).
      const local = await other.inject({ method: 'DELETE', url: '/api/bracket', remoteAddress: '127.0.0.1' });
      expect(local.statusCode).toBe(401);
    } finally {
      await other.close();
    }
  });
});

describe('GET /api/bracket', () => {
  it('answers { bracket: null } before one is made', async () => {
    for (const who of [host, display, signup]) {
      const res = await who('GET', '/api/bracket');
      expect(res.json()).toEqual({ bracket: null });
    }
  });

  it('gives a Display and a Sign-up device the same answer as the host, fields only', async () => {
    await make('double', 4);
    const answers = await Promise.all([host, display, signup].map((who) => who('GET', '/api/bracket')));
    expect(answers[1]?.json()).toEqual(answers[0]?.json());
    expect(answers[2]?.json()).toEqual(answers[0]?.json());
    expectContractShape(answers[0]?.json().bracket);
  });

  it('shows a renamed handle at once, because handles are read when the answer is made', async () => {
    await make('single', 4);
    await host('PATCH', `/api/players/${ids[0]}`, { handle: 'Renamed' });
    const bracket = (await current()) as Bracket;
    const handles = bracket.matches.flatMap((m) => m.slots.map((s) => s.player?.handle));
    expect(handles).toContain('Renamed');
    expect(handles).not.toContain('Player1');
  });

  it('rejects a body field it does not know on every write route', async () => {
    await make('single', 4);
    const match = onStations((await current()) as Bracket)[0];
    for (const [url, body] of [
      ['/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 2), extra: 1 }],
      ['/api/bracket/results', { matchId: match?.id, winnerId: match?.slots[0].player?.id, extra: 1 }],
      ['/api/bracket/undo', { resultId: 1, extra: 1 }],
      ['/api/bracket/players', { playerId: ids[5], extra: 1 }],
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
  it('close every object, including the nested match, slot, station, standings, and tie shapes', () => {
    const open: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) node.forEach((n, i) => walk(n, `${path}[${i}]`));
      else if (node && typeof node === 'object') {
        const schema = node as Record<string, unknown>;
        if (schema['type'] === 'object' && schema['additionalProperties'] !== false) open.push(path);
        for (const [key, value] of Object.entries(schema)) walk(value, `${path}.${key}`);
      }
    };
    walk(bracketSchema, 'bracket');
    walk(nullableBracketSchema, 'nullable');
    expect(open).toEqual([]);
    const text = JSON.stringify(bracketSchema);
    // match, slot, station, standings row, tie, player, and the bracket itself.
    expect(text.match(/"additionalProperties":false/g)?.length).toBeGreaterThanOrEqual(7);
  });
});

describe('POST /api/bracket', () => {
  it.each(['single', 'double', 'round_robin'] as const)('makes a %s bracket and answers 201 with the bracket', async (format) => {
    const res = await host('POST', '/api/bracket', { format, bestOf: 3, stations: 2, playerIds: ids.slice(0, 4) });
    expect(res.statusCode).toBe(201);
    const { bracket } = res.json();
    expect(Object.keys(res.json())).toEqual(['bracket']);
    expectContractShape(bracket);
    expect(bracket).toMatchObject({ format, bestOf: 3, finished: false, lastResultId: null });
    expect(bracket.stations).toHaveLength(2);
    expect(onStations(bracket).length).toBeGreaterThan(0);
    expect(bracket.matches.length).toBeGreaterThan(0);
    // The same answer comes back on a read.
    expect(await current()).toEqual(bracket);
  });

  it('stores the bracket as ids and settings only, with every player seeded once and no handle', async () => {
    const bracket = await make('single', 5, 3, 5);
    const row = db.prepare('SELECT format, best_of, stations, seeding FROM brackets').get() as Record<string, unknown>;
    expect(row).toMatchObject({ format: 'single', best_of: 5, stations: 3 });
    const seeding = JSON.parse(row['seeding'] as string) as Array<number | null>;
    expect(seeding.filter((id) => id !== null).sort()).toEqual(ids.slice(0, 5).sort());
    expect(seeding).toHaveLength(8);
    await win(bracket, 0, 0);
    const everything = JSON.stringify(
      ['brackets', 'bracket_results', 'bracket_late_joins', 'bracket_tie_breaks', 'event_players'].map((t) =>
        db.prepare(`SELECT * FROM ${t}`).all(),
      ),
    );
    expect(everything).not.toMatch(/Player\d/);
  });

  it('accepts exactly 2 to 32 players, and 3 to 32 for two lives', async () => {
    const many = addPlayers(db, 30, 9);
    const all = [...ids, ...many];
    expect(all).toHaveLength(38);
    const post = (format: string, count: number) =>
      host('POST', '/api/bracket', { format, bestOf: 1, stations: 1, playerIds: all.slice(0, count) });
    expect((await post('single', 1)).json()).toEqual({ error: 'too-few-players' });
    expect((await post('double', 2)).json()).toEqual({ error: 'too-few-players' });
    expect((await post('single', 0)).json()).toEqual({ error: 'too-few-players' });
    expect((await post('single', 33)).json()).toEqual({ error: 'too-many-players' });
    expect((await post('round_robin', 38)).statusCode).toBe(400);
    expect((await post('single', 32)).statusCode).toBe(201);
    await host('DELETE', '/api/bracket');
    expect((await post('single', 2)).statusCode).toBe(201);
    await host('DELETE', '/api/bracket');
    expect((await post('double', 3)).statusCode).toBe(201);
  });

  it.each([
    ['an unknown format', { format: 'swiss', bestOf: 1, stations: 1 }],
    ['a best of 2', { format: 'single', bestOf: 2, stations: 1 }],
    ['0 stations', { format: 'single', bestOf: 1, stations: 0 }],
    ['9 stations', { format: 'single', bestOf: 1, stations: 9 }],
    ['1.5 stations', { format: 'single', bestOf: 1, stations: 1.5 }],
    ['a string for stations', { format: 'single', bestOf: 1, stations: '2' }],
    ['no format', { bestOf: 1, stations: 1 }],
    ['no playerIds', { format: 'single', bestOf: 1, stations: 1, noPlayers: true }],
  ])('answers 400 bad-request for %s', async (_name, body) => {
    const res = await host('POST', '/api/bracket', { playerIds: ids.slice(0, 4), ...body });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect(await current()).toBeNull();
  });

  it.each([
    ['a player who does not exist', () => [ids[0], ids[1], 9999]],
    ['a player listed twice', () => [ids[0], ids[1], ids[1]]],
    ['a player id of 0', () => [ids[0], ids[1], 0]],
    ['a non-integer id', () => [ids[0], ids[1], 1.5]],
  ])('answers 400 bad-request for %s', async (_name, playerIds) => {
    const res = await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: playerIds() });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect(await current()).toBeNull();
  });

  it('answers 409 bracket-running while one is being played, and keeps it', async () => {
    const first = await make('single', 4);
    const res = await host('POST', '/api/bracket', { format: 'double', bestOf: 1, stations: 1, playerIds: ids.slice(0, 4) });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'bracket-running' });
    expect(await current()).toEqual(first);
  });

  it('replaces a finished bracket with the new one, and removes the old rows', async () => {
    const first = await make('single', 4);
    const done = await playOut(first, 0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bracket_results').get()).toEqual({ n: done.matches.filter((m) => m.status === 'done').length });
    const second = await make('round_robin', 3);
    expect(second.id).toBeGreaterThan(first.id);
    expect(second.format).toBe('round_robin');
    expect(db.prepare('SELECT COUNT(*) AS n FROM brackets').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM bracket_results').get()).toEqual({ n: 0 });
  });

  it('puts the bracket in the current event, naming one if the host has not', async () => {
    expect((await host('GET', '/api/event')).json()).toEqual({ event: null });
    await make('single', 2, 1);
    expect((await host('GET', '/api/event')).json()).toEqual({ event: { name: 'ColiseumGrid', game: null } });
    const row = db.prepare('SELECT e.name FROM brackets b JOIN events e ON e.id = b.event_id').get();
    expect(row).toEqual({ name: 'ColiseumGrid' });
  });

  it('keeps the event the host named', async () => {
    await host('PUT', '/api/event', { name: 'Friday night' });
    await make('single', 2, 1);
    expect((await host('GET', '/api/event')).json()).toEqual({ event: { name: 'Friday night', game: null } });
    expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 1 });
  });
});

describe('POST /api/bracket/results', () => {
  it('records a result, answers { bracket, resultId }, and calls the next match', async () => {
    const bracket = await make('single', 4, 1);
    const first = onStations(bracket)[0];
    const res = await win(bracket, 0, 1);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['bracket', 'resultId']);
    expectContractShape(body.bracket);
    expect(body.bracket.lastResultId).toBe(body.resultId);
    const done = body.bracket.matches.find((m: { id: number }) => m.id === first?.id);
    expect(done).toMatchObject({ status: 'done', winner: 1, resultId: body.resultId });
    expect(onStations(body.bracket)[0]?.id).not.toBe(first?.id);
    expect(db.prepare('SELECT match_id, winner_id, loser_id FROM bracket_results').all()).toEqual([
      { match_id: first?.id, winner_id: first?.slots[1].player?.id, loser_id: first?.slots[0].player?.id },
    ]);
  });

  it('stamps the result with the time it was recorded', async () => {
    const bracket = await make('single', 4, 1);
    const before = Date.now();
    await win(bracket, 0, 0);
    const row = db.prepare('SELECT at FROM bracket_results').get() as { at: string };
    expect(Date.parse(row.at)).toBeGreaterThanOrEqual(before - 1000);
    expect(row.at).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
  });

  it('answers 404 no-bracket when there is no bracket, and not-found for a match that does not exist', async () => {
    const none = await host('POST', '/api/bracket/results', { matchId: 0, winnerId: ids[0] });
    expect(none.statusCode).toBe(404);
    expect(none.json()).toEqual({ error: 'no-bracket' });
    await make('single', 4, 1);
    const missing = await host('POST', '/api/bracket/results', { matchId: 777, winnerId: ids[0] });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not-found' });
  });

  it('answers 409 not-on-station for a match that is waiting, ready, or done', async () => {
    const bracket = await make('single', 8, 1);
    const waiting = bracket.matches.find((m) => m.status === 'waiting');
    const ready = bracket.matches.find((m) => m.status === 'ready');
    expect(waiting).toBeDefined();
    expect(ready).toBeDefined();
    for (const match of [waiting, ready]) {
      const res = await host('POST', '/api/bracket/results', { matchId: match?.id, winnerId: ids[0] });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'not-on-station' });
    }
    const played = onStations(bracket)[0];
    await win(bracket, 0, 0);
    const again = await host('POST', '/api/bracket/results', { matchId: played?.id, winnerId: played?.slots[0].player?.id });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'not-on-station' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM bracket_results').get()).toEqual({ n: 1 });
  });

  it('answers 400 bad-request when the winner is not in the match, or the body is malformed', async () => {
    const bracket = await make('single', 4, 1);
    const match = onStations(bracket)[0];
    const outsider = ids.find((id) => !match?.slots.some((s) => s.player?.id === id));
    for (const body of [
      { matchId: match?.id, winnerId: outsider },
      { matchId: match?.id, winnerId: 0 },
      { matchId: match?.id, winnerId: '1' },
      { matchId: match?.id },
      { matchId: -1, winnerId: 1 },
    ]) {
      const res = await host('POST', '/api/bracket/results', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM bracket_results').get()).toEqual({ n: 0 });
  });
});

describe('POST /api/bracket/undo', () => {
  it('takes the newest result back and gives the bracket exactly as it was', async () => {
    const start = await make('double', 4, 2);
    const first = (await win(start, 0, 0)).json();
    const second = (await win(first.bracket, 0, 1)).json();
    const res = await host('POST', '/api/bracket/undo', { resultId: second.resultId });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json())).toEqual(['bracket']);
    expect(res.json().bracket).toEqual(first.bracket);
    expect(await current()).toEqual(first.bracket);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bracket_results').get()).toEqual({ n: 1 });
  });

  it('never gives an undone result id to a later result', async () => {
    const start = await make('single', 4, 1);
    const first = (await win(start, 0, 0)).json();
    await host('POST', '/api/bracket/undo', { resultId: first.resultId });
    const again = (await win((await current()) as Bracket, 0, 0)).json();
    expect(again.resultId).toBeGreaterThan(first.resultId);
    // A screen still holding the old id can't take back the new result.
    const stale = await host('POST', '/api/bracket/undo', { resultId: first.resultId });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'nothing-to-undo' });
  });

  it('answers 409 nothing-to-undo for a result that is not in the log, and 404 no-bracket with no bracket', async () => {
    const none = await host('POST', '/api/bracket/undo', { resultId: 1 });
    expect(none.statusCode).toBe(404);
    expect(none.json()).toEqual({ error: 'no-bracket' });
    await make('single', 4, 1);
    const missing = await host('POST', '/api/bracket/undo', { resultId: 42 });
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toEqual({ error: 'nothing-to-undo' });
  });

  it('answers 409 undo-later-first when a later result depends on the older one, and changes nothing', async () => {
    const start = await make('single', 4, 2);
    const semis = onStations(start);
    expect(semis).toHaveLength(2);
    const a = (await win(start, 0, 0)).json();
    const b = (await win(a.bracket, 0, 0)).json();
    const final = onStations(b.bracket)[0];
    expect(final).toBeDefined();
    const c = (await win(b.bracket, 0, 0)).json();
    const res = await host('POST', '/api/bracket/undo', { resultId: a.resultId });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'undo-later-first' });
    expect(await current()).toEqual(c.bracket);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bracket_results').get()).toEqual({ n: 3 });
  });

  it('answers 400 bad-request for a body that is not a result id', async () => {
    await make('single', 4, 1);
    for (const body of [{}, { resultId: 0 }, { resultId: 'x' }]) {
      const res = await host('POST', '/api/bracket/undo', body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
  });
});

describe('POST /api/bracket/players', () => {
  it('lets a late player take a bye and play, and stores the join', async () => {
    const start = await make('single', 3, 2);
    expect(start.lateOpen).toBe(true);
    const res = await host('POST', '/api/bracket/players', { playerId: ids[3] });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json())).toEqual(['bracket']);
    expectContractShape(res.json().bracket);
    expect(res.json().bracket.lateOpen).toBe(false);
    const shown = res.json().bracket.matches.flatMap((m: Bracket['matches'][number]) => m.slots.map((s) => s.player?.id));
    expect(shown).toContain(ids[3]);
    expect(db.prepare('SELECT player_id, step FROM bracket_late_joins').all()).toEqual([{ player_id: ids[3], step: 0 }]);
    const seeding = JSON.parse((db.prepare('SELECT seeding FROM brackets').get() as { seeding: string }).seeding) as Array<number | null>;
    expect(seeding).toContain(ids[3]);
  });

  it('answers 409 already-in for a player who is in the bracket', async () => {
    await make('single', 3, 2);
    const res = await host('POST', '/api/bracket/players', { playerId: ids[0] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'already-in' });
  });

  it('answers 409 late-closed with no bye left, and once round 1 is finished', async () => {
    await make('single', 4, 2);
    const full = await host('POST', '/api/bracket/players', { playerId: ids[4] });
    expect(full.statusCode).toBe(409);
    expect(full.json()).toEqual({ error: 'late-closed' });
    expect(((await current()) as Bracket).lateOpen).toBe(false);

    await host('DELETE', '/api/bracket');
    const start = await make('single', 5, 3);
    // Five players: three byes. Finish round 1 (one match), then the byes are closed.
    expect(start.lateOpen).toBe(true);
    const round1 = start.matches.filter((m) => m.round === 1 && m.status !== 'bye' && m.side === 'main');
    expect(round1).toHaveLength(1);
    const played = await win(start, 0, 0);
    expect(played.statusCode).toBe(200);
    const closed = await host('POST', '/api/bracket/players', { playerId: ids[5] });
    expect(closed.statusCode).toBe(409);
    expect(closed.json()).toEqual({ error: 'late-closed' });
  });

  it('answers 404 not-found for a player who does not exist, and no-bracket when there is no bracket', async () => {
    const none = await host('POST', '/api/bracket/players', { playerId: ids[0] });
    expect(none.statusCode).toBe(404);
    expect(none.json()).toEqual({ error: 'no-bracket' });
    await make('single', 3, 2);
    const missing = await host('POST', '/api/bracket/players', { playerId: 9999 });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not-found' });
  });

  it('answers 400 bad-request for a body that is not a player id', async () => {
    await make('single', 3, 2);
    for (const body of [{}, { playerId: 0 }, { playerId: 'a' }]) {
      expect((await host('POST', '/api/bracket/players', body)).statusCode).toBe(400);
    }
  });
});

describe('POST /api/bracket/tie-break', () => {
  it('answers 409 no-tie when no tie waits, and 404 no-bracket when there is no bracket', async () => {
    const none = await host('POST', '/api/bracket/tie-break');
    expect(none.statusCode).toBe(404);
    expect(none.json()).toEqual({ error: 'no-bracket' });
    for (const format of ['single', 'double', 'round_robin'] as const) {
      await make(format, 4, 1);
      const res = await host('POST', '/api/bracket/tie-break');
      expect(res.statusCode, format).toBe(409);
      expect(res.json()).toEqual({ error: 'no-tie' });
      await host('DELETE', '/api/bracket');
    }
  });
});

describe('DELETE /api/bracket', () => {
  it('removes the bracket and all its rows, and answers 204 with no body', async () => {
    const start = await make('round_robin', 4, 2);
    await win(start, 0, 0);
    const res = await host('DELETE', '/api/bracket');
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(await current()).toBeNull();
    for (const table of ['brackets', 'bracket_results', 'bracket_late_joins', 'bracket_tie_breaks']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
    }
  });

  it('answers 204 again when there is nothing to delete', async () => {
    expect((await host('DELETE', '/api/bracket')).statusCode).toBe(204);
    await make('single', 2, 1);
    expect((await host('DELETE', '/api/bracket')).statusCode).toBe(204);
    expect((await host('DELETE', '/api/bracket')).statusCode).toBe(204);
  });

  it('lets a new bracket start while the old one was running', async () => {
    await make('single', 4);
    await host('DELETE', '/api/bracket');
    expect(((await host('POST', '/api/bracket', { format: 'double', bestOf: 1, stations: 1, playerIds: ids.slice(0, 4) })).statusCode)).toBe(201);
  });
});

describe('a bracket survives a restart exactly', () => {
  it('reads back the same answer from the file after the app is rebuilt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coliseumgrid-bracket-'));
    try {
      const file = join(dir, 'test.db');
      const first = await buildApp({ db: openDatabase(file), hostPassword: HOST_PASSWORD });
      const api = caller(first, await signInHost(first));
      for (const handle of ['A1', 'B2', 'C3', 'D4', 'E5']) {
        expect((await api('POST', '/api/players', { handle })).statusCode).toBe(201);
      }
      const all = ((await api('GET', '/api/players')).json().players as { id: number }[]).map((p) => p.id);
      let bracket = (await api('POST', '/api/bracket', { format: 'round_robin', bestOf: 3, stations: 2, playerIds: all })).json().bracket as Bracket;
      for (let i = 0; i < 4; i++) {
        const match = onStations(bracket)[0];
        const res = await api('POST', '/api/bracket/results', { matchId: match?.id, winnerId: match?.slots[i % 2 === 0 ? 0 : 1].player?.id });
        expect(res.statusCode, res.body).toBe(200);
        bracket = res.json().bracket;
      }
      // One undo, so the stored rows have been rewritten as well as added to.
      bracket = (await api('POST', '/api/bracket/undo', { resultId: bracket.lastResultId })).json().bracket;
      await first.close();

      const second = await buildApp({ db: openDatabase(file), hostPassword: HOST_PASSWORD });
      const again = caller(second, await signInHost(second));
      expect((await again('GET', '/api/bracket')).json()).toEqual({ bracket });
      await second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
