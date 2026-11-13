// Two taps at once must not interleave (docs/PLAN.md, "Brackets API", "Heats API"). The heat
// engine is synchronous, so two heats writes can't overlap each other. What can overlap is a
// heats write and a bracket write, because the bracket engine is asynchronous: without the
// shared write chain a heats route would run in the middle of a bracket create, and an event
// could end up with both kinds. Every request here is sent before any answer is awaited.

import type { Bracket, Heat, Heats } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { addPlayers, makeCallers, onStations, type Api } from './bracket-api-helpers.ts';
import { heatsBody, heatsOnStations, makeHeats, recordListed } from './heat-api-helpers.ts';

// The bracket engine only ever waits on promises that resolve at once, so one request runs to
// its end before the next one starts and nothing here could interleave. A pause before each
// engine call stands in for the real gaps (a slower library, a database that waits on a disk),
// so these tests fail if a route skips the write chain.
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
  ids = addPlayers(db, 14);
});
afterEach(() => app.close());

const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const bracketBody = (n: number) => ({ format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, n) });
const resultBody = (heats: Heats, which: number) => {
  const heat = heatsOnStations(heats)[which] as Heat;
  return { heatId: heat.id, order: heat.players.map((p) => p.id) };
};

describe('one competition per event, with the bracket engine slow', () => {
  it('lets only one of a new bracket and new heats be made, the bracket sent first', async () => {
    const [bracket, heats] = await Promise.all([host('POST', '/api/bracket', bracketBody(4)), host('POST', '/api/heats', heatsBody(ids.slice(0, 5)))]);
    expect([bracket.statusCode, heats.statusCode]).toEqual([201, 409]);
    expect(heats.json()).toEqual({ error: 'bracket-running' });
    expect(count('brackets')).toBe(1);
    expect(count('heat_runs')).toBe(0);
  });

  it('lets only one of new heats and a new bracket be made, the heats sent first', async () => {
    const [heats, bracket] = await Promise.all([host('POST', '/api/heats', heatsBody(ids.slice(0, 5))), host('POST', '/api/bracket', bracketBody(4))]);
    expect([heats.statusCode, bracket.statusCode]).toEqual([201, 409]);
    expect(bracket.json()).toEqual({ error: 'bracket-running' });
    expect(count('brackets')).toBe(0);
    expect(count('heat_runs')).toBe(1);
  });

  it('lets only one of two new heats be made', async () => {
    const body = heatsBody(ids.slice(0, 5));
    const [a, b] = await Promise.all([host('POST', '/api/heats', body), host('POST', '/api/heats', body)]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 409]);
    expect(b.json()).toEqual({ error: 'bracket-running' });
    expect(count('heat_runs')).toBe(1);
  });

  it('makes a heats write wait for a bracket create that replaces the finished heats, and find them gone', async () => {
    const heats = await makeHeats(host, ids.slice(0, 3));
    const final = (await recordListed(host, heatsOnStations(heats)[0] as Heat)).json();
    expect(final.heats.finished).toBe(true);
    // The bracket create is slow. The undo is sent after it, so it must run after it.
    const [bracket, undo] = await Promise.all([
      host('POST', '/api/bracket', bracketBody(4)),
      host('POST', '/api/heats/undo', { resultId: final.resultId }),
    ]);
    expect(bracket.statusCode).toBe(201);
    expect(undo.statusCode).toBe(404);
    expect(undo.json()).toEqual({ error: 'no-heats' });
    expect(count('brackets')).toBe(1);
    expect(count('heat_runs')).toBe(0);
  });

  it('makes a bracket create wait for the heats write sent before it', async () => {
    const heats = await makeHeats(host, ids.slice(0, 3));
    // The final's result finishes the heats; a bracket sent right behind it replaces them.
    const [result, bracket] = await Promise.all([host('POST', '/api/heats/results', resultBody(heats, 0)), host('POST', '/api/bracket', bracketBody(4))]);
    expect(result.statusCode).toBe(200);
    expect(bracket.statusCode).toBe(201);
    expect(count('heat_runs')).toBe(0);
    expect(count('brackets')).toBe(1);
  });

  it('makes a merge wait for the bracket create sent before it, so it finds the player in the bracket', async () => {
    const [bracket, merge] = await Promise.all([
      host('POST', '/api/bracket', bracketBody(4)),
      host('POST', `/api/players/${ids[0]}/merge`, { intoId: ids[9] }),
    ]);
    expect([bracket.statusCode, merge.statusCode]).toEqual([201, 409]);
    expect(merge.json()).toEqual({ error: 'in-bracket' });
    expect((await host('GET', '/api/bracket')).statusCode).toBe(200);
  });

  it('reads a bracket while heats are made without seeing both kinds', async () => {
    const reads = Array.from({ length: 5 }, () => Promise.all([host('GET', '/api/bracket'), host('GET', '/api/heats')]));
    const [made, ...answers] = await Promise.all([host('POST', '/api/heats', heatsBody(ids.slice(0, 5))), ...reads]);
    expect(made.statusCode).toBe(201);
    for (const [bracket, heats] of answers) {
      expect(bracket?.json().bracket).toBeNull();
      expect([null, made.json().heats.id]).toContain(heats?.json().heats?.id ?? null);
    }
  });
});

describe('two heats writes at once', () => {
  it('applies two results for two stations, in the order they arrived, and loses neither', async () => {
    const heats = await makeHeats(host, ids.slice(0, 10), { stations: 2 });
    const [a, b] = await Promise.all([host('POST', '/api/heats/results', resultBody(heats, 0)), host('POST', '/api/heats/results', resultBody(heats, 1))]);
    expect(a.statusCode, a.body).toBe(200);
    expect(b.statusCode, b.body).toBe(200);
    // Ids are given out in arrival order, and the second answer already holds the first result.
    expect(b.json().resultId).toBeGreaterThan(a.json().resultId);
    expect(a.json().heats.heats.filter((h: Heat) => h.status === 'done')).toHaveLength(1);
    expect(b.json().heats.heats.filter((h: Heat) => h.status === 'done')).toHaveLength(2);
    expect(db.prepare('SELECT id, heat_id FROM heat_results ORDER BY id').all()).toEqual([
      { id: a.json().resultId, heat_id: resultBody(heats, 0).heatId },
      { id: b.json().resultId, heat_id: resultBody(heats, 1).heatId },
    ]);
    const now = (await host('GET', '/api/heats')).json().heats as Heats;
    expect(now.lastResultId).toBe(b.json().resultId);
    expect(now).toEqual(b.json().heats);
  });

  it('answers the second tap on the same heat with a clean 409 and records one result', async () => {
    const heats = await makeHeats(host, ids.slice(0, 10), { stations: 2 });
    const body = resultBody(heats, 0);
    const [a, b] = await Promise.all([host('POST', '/api/heats/results', body), host('POST', '/api/heats/results', body)]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(409);
    expect(b.json()).toEqual({ error: 'not-on-station' });
    expect(count('heat_results')).toBe(1);
  });

  it('lets a result and the undo of the one before it arrive together', async () => {
    const heats = await makeHeats(host, ids.slice(0, 10), { stations: 2 });
    const first = (await host('POST', '/api/heats/results', resultBody(heats, 0))).json();
    const [undo, next] = await Promise.all([
      host('POST', '/api/heats/undo', { resultId: first.resultId }),
      // Heat 103 took the freed station and goes back to Up next with the undo; heat 102 stays put.
      host('POST', '/api/heats/results', resultBody(first.heats, 1)),
    ]);
    expect(undo.statusCode).toBe(200);
    expect(next.statusCode).toBe(200);
    const rows = db.prepare('SELECT id FROM heat_results').all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as { id: number }).id).toBe(next.json().resultId);
  });

  it('applies two late joins one after the other, never into the same heat', async () => {
    // 10 players on two stations: heat 103 waits with 3, so one late player fits and then it is full.
    await makeHeats(host, ids.slice(0, 10), { stations: 2 });
    const [a, b] = await Promise.all([
      host('POST', '/api/heats/players', { playerId: ids[10] }),
      host('POST', '/api/heats/players', { playerId: ids[11] }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 409]);
    expect(b.json()).toEqual({ error: 'late-closed' });
    expect(db.prepare('SELECT player_id FROM heat_late_joins').all()).toEqual([{ player_id: ids[10] }]);
  });

  it('reads while a write is running without seeing half of it', async () => {
    const heats = await makeHeats(host, ids.slice(0, 10), { stations: 2 });
    const reads = Array.from({ length: 5 }, () => host('GET', '/api/heats'));
    const write = host('POST', '/api/heats/results', resultBody(heats, 0));
    const answers = await Promise.all([...reads, write]);
    for (const read of answers.slice(0, 5)) {
      const done = (read.json().heats as Heats).heats.filter((h) => h.status === 'done').length;
      expect([0, 1]).toContain(done);
    }
  });

  it('never lets a late join and a merge of the same player both succeed', async () => {
    await makeHeats(host, ids.slice(0, 10), { stations: 2 });
    const [join, merge] = await Promise.all([
      host('POST', '/api/heats/players', { playerId: ids[10] }),
      host('POST', `/api/players/${ids[10]}/merge`, { intoId: ids[0] }),
    ]);
    // The join came first, so by the time the merge runs the player is in the heats.
    expect([join.statusCode, merge.statusCode]).toEqual([200, 409]);
    expect(merge.json()).toEqual({ error: 'in-bracket' });
    const answer = await host('GET', '/api/heats');
    expect(answer.statusCode).toBe(200);
    expect(JSON.stringify(answer.json())).toContain('Player11');
  });

  it('lets the merge win when it comes first, and then answers the join with not-found', async () => {
    await makeHeats(host, ids.slice(0, 10), { stations: 2 });
    const [merge, join] = await Promise.all([
      host('POST', `/api/players/${ids[10]}/merge`, { intoId: ids[0] }),
      host('POST', '/api/heats/players', { playerId: ids[10] }),
    ]);
    expect([merge.statusCode, join.statusCode]).toEqual([200, 404]);
    expect(join.json()).toEqual({ error: 'not-found' });
  });
});

// A bracket write is slow here too, so a bracket result sent right after a heats create waits.
describe('a bracket write and a heats write in turn', () => {
  it('keeps a bracket result and the heats create that follows it apart', async () => {
    const made = (await host('POST', '/api/bracket', bracketBody(2))).json().bracket as Bracket;
    const match = onStations(made)[0];
    const [result, heats] = await Promise.all([
      host('POST', '/api/bracket/results', { matchId: match?.id, winnerId: match?.slots[0].player?.id }),
      host('POST', '/api/heats', heatsBody(ids.slice(0, 5))),
    ]);
    // The result finished the bracket first, so the heats replace it.
    expect(result.statusCode).toBe(200);
    expect(heats.statusCode).toBe(201);
    expect(count('brackets')).toBe(0);
    expect(count('heat_runs')).toBe(1);
  });
});
