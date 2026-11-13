// Two taps at once must not interleave (docs/PLAN.md, "Brackets API"): the engine is
// asynchronous, so a route that loads, changes, and saves would otherwise save from a stale
// start and lose the other tap's result. Every request here is sent before any answer is awaited.

import type { Bracket } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { addPlayers, makeCallers, onStations, type Api } from './bracket-api-helpers.ts';

// The engine works on an in-memory store and only ever waits on promises that resolve at once,
// so one request runs to its end before the next one starts and nothing here could interleave.
// A pause before each engine call stands in for the real gaps (a slower library, a database
// that waits on a disk), so these tests fail if a route skips the write chain.
vi.mock('../src/bracket-engine.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/bracket-engine.ts')>();
  const slow =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return call(...args);
    };
  return {
    ...real,
    bracketAnswer: slow(real.bracketAnswer),
    createBracket: slow(real.createBracket),
    recordResult: slow(real.recordResult),
    undoResult: slow(real.undoResult),
    joinLate: slow(real.joinLate),
    startTieBreak: slow(real.startTieBreak),
  };
});

let app: FastifyInstance;
let db: Database;
let host: Api;
let ids: number[];

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = await buildApp({ db });
  ({ host } = await makeCallers(app));
  ids = addPlayers(db, 8);
});
afterEach(() => app.close());

const make = async (format: string, count: number, stations: number): Promise<Bracket> =>
  (await host('POST', '/api/bracket', { format, bestOf: 1, stations, playerIds: ids.slice(0, count) })).json().bracket;

const resultBody = (bracket: Bracket, which: number) => {
  const match = onStations(bracket)[which];
  return { matchId: match?.id, winnerId: match?.slots[0].player?.id };
};

describe('two writes at once', () => {
  it('applies two results for two stations, in the order they arrived, and loses neither', async () => {
    const bracket = await make('single', 4, 2);
    expect(onStations(bracket)).toHaveLength(2);
    const [a, b] = await Promise.all([
      host('POST', '/api/bracket/results', resultBody(bracket, 0)),
      host('POST', '/api/bracket/results', resultBody(bracket, 1)),
    ]);
    expect(a.statusCode, a.body).toBe(200);
    expect(b.statusCode, b.body).toBe(200);
    // Ids are given out in arrival order, and the second answer already holds the first result.
    expect(b.json().resultId).toBeGreaterThan(a.json().resultId);
    expect(a.json().bracket.matches.filter((m: { status: string }) => m.status === 'done')).toHaveLength(1);
    expect(b.json().bracket.matches.filter((m: { status: string }) => m.status === 'done')).toHaveLength(2);

    const rows = db.prepare('SELECT id, match_id FROM bracket_results ORDER BY id').all();
    expect(rows).toEqual([
      { id: a.json().resultId, match_id: resultBody(bracket, 0).matchId },
      { id: b.json().resultId, match_id: resultBody(bracket, 1).matchId },
    ]);
    const now = (await host('GET', '/api/bracket')).json().bracket as Bracket;
    expect(now.lastResultId).toBe(b.json().resultId);
    expect(now).toEqual(b.json().bracket);
  });

  it('applies many results at once without losing one', async () => {
    const bracket = await make('round_robin', 6, 3);
    const live = onStations(bracket);
    expect(live).toHaveLength(3);
    const answers = await Promise.all(live.map((_, i) => host('POST', '/api/bracket/results', resultBody(bracket, i))));
    expect(answers.map((a) => a.statusCode)).toEqual([200, 200, 200]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bracket_results').get()).toEqual({ n: 3 });
    const resultIds = answers.map((a) => a.json().resultId as number);
    expect([...resultIds].sort((x, y) => x - y)).toEqual(resultIds);
    expect(new Set(resultIds).size).toBe(3);
  });

  it('answers the second tap on the same match with a clean 409 and records one result', async () => {
    const bracket = await make('single', 4, 2);
    const body = resultBody(bracket, 0);
    const [a, b] = await Promise.all([host('POST', '/api/bracket/results', body), host('POST', '/api/bracket/results', body)]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(409);
    expect(b.json()).toEqual({ error: 'not-on-station' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM bracket_results').get()).toEqual({ n: 1 });
  });

  it('lets a result and the undo of the one before it arrive together', async () => {
    const bracket = await make('single', 4, 2);
    const first = (await host('POST', '/api/bracket/results', resultBody(bracket, 0))).json();
    const [undo, next] = await Promise.all([
      host('POST', '/api/bracket/undo', { resultId: first.resultId }),
      host('POST', '/api/bracket/results', resultBody(first.bracket, 0)),
    ]);
    // The undo ran first; the match the second tap named stayed on its station through it.
    expect(undo.statusCode).toBe(200);
    expect(next.statusCode).toBe(200);
    const ids = db.prepare('SELECT id FROM bracket_results').all();
    expect(ids).toHaveLength(1);
    expect((ids[0] as { id: number }).id).toBe(next.json().resultId);
  });

  it('lets only one of two new brackets be made', async () => {
    const body = { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 4) };
    const [a, b] = await Promise.all([host('POST', '/api/bracket', body), host('POST', '/api/bracket', body)]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 409]);
    expect(b.json()).toEqual({ error: 'bracket-running' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM brackets').get()).toEqual({ n: 1 });
  });

  it('applies two late joins at once one after the other, never into the same slot', async () => {
    await make('round_robin', 3, 1);
    // Three players leave one empty slot: the first join takes it and the second is refused.
    const [a, b] = await Promise.all([
      host('POST', '/api/bracket/players', { playerId: ids[3] }),
      host('POST', '/api/bracket/players', { playerId: ids[4] }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 409]);
    expect(b.json()).toEqual({ error: 'late-closed' });
    const seeding = JSON.parse((db.prepare('SELECT seeding FROM brackets').get() as { seeding: string }).seeding) as Array<number | null>;
    expect(seeding.filter((id) => id === ids[3] || id === ids[4])).toEqual([ids[3]]);
  });

  it('reads while a write is running without seeing half of it', async () => {
    const bracket = await make('single', 4, 2);
    const reads = Array.from({ length: 5 }, () => host('GET', '/api/bracket'));
    const write = host('POST', '/api/bracket/results', resultBody(bracket, 0));
    const answers = await Promise.all([...reads, write]);
    for (const read of answers.slice(0, 5)) {
      const doneCount = (read.json().bracket as Bracket).matches.filter((m) => m.status === 'done').length;
      expect([0, 1]).toContain(doneCount);
    }
  });

  it('never lets a late join and a merge of the same player both succeed', async () => {
    const [a, , , d] = ids as [number, number, number, number];
    await make('single', 3, 2);
    const [join, merge] = await Promise.all([
      host('POST', '/api/bracket/players', { playerId: d }),
      host('POST', `/api/players/${d}/merge`, { intoId: a }),
    ]);
    // The join came first, so by the time the merge runs the player is in the bracket.
    expect([join.statusCode, merge.statusCode]).toEqual([200, 409]);
    expect(merge.json()).toEqual({ error: 'in-bracket' });
    const answer = await host('GET', '/api/bracket');
    expect(answer.statusCode).toBe(200);
    expect(JSON.stringify(answer.json())).toContain('Player4');
  });
});
