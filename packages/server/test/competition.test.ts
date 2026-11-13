// One competition per event (docs/PLAN.md, "Heats API", "One competition per event"): a
// bracket or heats, never both. A new one of either kind is refused while the event's current
// one is being played, and replaces a finished one of either kind.

import type { Bracket, Heats } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createBracketStore } from '../src/bracket-store.ts';
import { createCompetition } from '../src/competition.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { createHeatStore } from '../src/heat-store.ts';
import { createPlayers } from '../src/players.ts';
import { addPlayers, makeCallers, onStations, type Api } from './bracket-api-helpers.ts';
import { heatsBody, makeHeats, playListed } from './heat-api-helpers.ts';
import { start as startHeats } from './heat-helpers.ts';

let app: FastifyInstance;
let db: Database;
let host: Api;
let ids: number[];

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = await buildApp({ db });
  ({ host } = await makeCallers(app));
  ids = addPlayers(db, 10);
});
afterEach(() => app.close());

const bracketBody = (count: number, stations = 1) => ({ format: 'single', bestOf: 1, stations, playerIds: ids.slice(0, count) });
const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const bracketNow = async (): Promise<Bracket | null> => (await host('GET', '/api/bracket')).json().bracket;
const heatsNow = async (): Promise<Heats | null> => (await host('GET', '/api/heats')).json().heats;

/** A two-player bracket played to its end. */
async function finishedBracket(): Promise<Bracket> {
  const made = (await host('POST', '/api/bracket', bracketBody(2))).json().bracket as Bracket;
  const match = onStations(made)[0];
  const res = await host('POST', '/api/bracket/results', { matchId: match?.id, winnerId: match?.slots[0].player?.id });
  expect(res.json().bracket.finished).toBe(true);
  return res.json().bracket;
}

describe('a competition being played', () => {
  it('refuses a bracket while heats are being played, and keeps the heats', async () => {
    const heats = await makeHeats(host, ids.slice(0, 5));
    const res = await host('POST', '/api/bracket', bracketBody(4));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'bracket-running' });
    expect(await heatsNow()).toEqual(heats);
    expect(await bracketNow()).toBeNull();
    expect(count('brackets')).toBe(0);
  });

  it('refuses heats while a bracket is being played, and keeps the bracket', async () => {
    const bracket = (await host('POST', '/api/bracket', bracketBody(4))).json().bracket as Bracket;
    const res = await host('POST', '/api/heats', heatsBody(ids.slice(0, 5)));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'bracket-running' });
    expect(await bracketNow()).toEqual(bracket);
    expect(await heatsNow()).toBeNull();
    expect(count('heat_runs')).toBe(0);
  });

  it('counts heats with a tie waiting at the cut as still being played', async () => {
    const heats = await playListed(host, await makeHeats(host, ids));
    expect(heats.finished).toBe(false);
    expect(heats.ties).toHaveLength(1);
    expect((await host('POST', '/api/bracket', bracketBody(4))).json()).toEqual({ error: 'bracket-running' });
    expect((await host('POST', '/api/heats', heatsBody(ids.slice(0, 5)))).json()).toEqual({ error: 'bracket-running' });
    expect(await heatsNow()).toEqual(heats);
  });
});

describe('a finished competition', () => {
  it('is replaced by a bracket when it was heats, and the heats and their rows are gone', async () => {
    const heats = await playListed(host, await makeHeats(host, ids.slice(0, 3)));
    expect(heats.finished).toBe(true);
    expect(count('heat_results')).toBe(1);
    const res = await host('POST', '/api/bracket', bracketBody(4));
    expect(res.statusCode, res.body).toBe(201);
    expect(await heatsNow()).toBeNull();
    for (const table of ['heat_runs', 'heat_results', 'heat_late_joins', 'heat_tie_breaks']) expect(count(table), table).toBe(0);
    expect(await bracketNow()).toEqual(res.json().bracket);
  });

  it('is replaced by heats when it was a bracket, and the bracket and its rows are gone', async () => {
    await finishedBracket();
    expect(count('bracket_results')).toBe(1);
    const res = await host('POST', '/api/heats', heatsBody(ids.slice(0, 5)));
    expect(res.statusCode, res.body).toBe(201);
    expect(await bracketNow()).toBeNull();
    for (const table of ['brackets', 'bracket_results', 'bracket_late_joins', 'bracket_tie_breaks']) expect(count(table), table).toBe(0);
    expect(await heatsNow()).toEqual(res.json().heats);
  });

  it('is replaced by its own kind, as before', async () => {
    await playListed(host, await makeHeats(host, ids.slice(0, 3)));
    expect((await host('POST', '/api/heats', heatsBody(ids.slice(0, 5)))).statusCode).toBe(201);
    expect(count('heat_runs')).toBe(1);
    await host('DELETE', '/api/heats');
    await finishedBracket();
    expect((await host('POST', '/api/bracket', bracketBody(3))).statusCode).toBe(201);
    expect(count('brackets')).toBe(1);
  });

  it('stays when a new bracket is refused', async () => {
    const heats = await playListed(host, await makeHeats(host, ids.slice(0, 3)));
    expect((await host('POST', '/api/bracket', { ...bracketBody(4), bestOf: 2 })).statusCode).toBe(400);
    expect((await host('POST', '/api/bracket', bracketBody(1))).json()).toEqual({ error: 'too-few-players' });
    expect(await heatsNow()).toEqual(heats);
  });

  it('stays when new heats are refused', async () => {
    const bracket = await finishedBracket();
    expect((await host('POST', '/api/heats', { ...heatsBody(ids.slice(0, 5)), rounds: 9 })).statusCode).toBe(400);
    expect((await host('POST', '/api/heats', heatsBody(ids.slice(0, 1)))).json()).toEqual({ error: 'too-few-players' });
    expect(await bracketNow()).toEqual(bracket);
  });
});

describe('a deleted competition', () => {
  it('lets the other kind start at once', async () => {
    await makeHeats(host, ids.slice(0, 5));
    await host('DELETE', '/api/heats');
    expect((await host('POST', '/api/bracket', bracketBody(4))).statusCode).toBe(201);
    await host('DELETE', '/api/bracket');
    expect((await host('POST', '/api/heats', heatsBody(ids.slice(0, 5)))).statusCode).toBe(201);
  });
});

describe('another event', () => {
  it('is not held up by the competition of an earlier one', async () => {
    await makeHeats(host, ids.slice(0, 5));
    db.prepare("INSERT INTO events (name, created_at) VALUES ('Next', 't')").run();
    expect(await heatsNow()).toBeNull();
    expect((await host('POST', '/api/bracket', bracketBody(4))).statusCode).toBe(201);
    expect(count('heat_runs')).toBe(1);
    expect(count('brackets')).toBe(1);
  });
});

describe('the competition as a whole', () => {
  it('replaces the other kind in one step: a failed save leaves it where it was', () => {
    const brackets = createBracketStore(db);
    const heats = createHeatStore(db);
    const competition = createCompetition(db, brackets, heats, createPlayers(db));
    const eventId = Number(db.prepare("INSERT INTO events (name, created_at) VALUES ('Friday', 't')").run().lastInsertRowid);
    brackets.save(eventId, {
      settings: { id: 1, format: 'single', bestOf: 1, stations: 1, createdAt: 't' },
      seeding: [ids[0] as number, ids[1] as number],
      lateJoins: [],
      results: [],
      tieBreaks: [],
    });
    const run = startHeats(5, 3, { stations: 1, rounds: 1 });
    const broken = { ...run.state, settings: { ...run.state.settings, createdAt: null as never } };
    expect(() => competition.startHeats(eventId, broken)).toThrow();
    expect(count('brackets')).toBe(1);
    expect(count('heat_runs')).toBe(0);
    // And the same save, made whole, takes the bracket's place.
    expect(competition.startHeats(eventId, run.state)).toBe(true);
    expect(count('brackets')).toBe(0);
    expect(count('heat_runs')).toBe(1);
    expect(competition.hasPlayer(eventId, 1)).toBe(true);
    expect(competition.hasPlayer(eventId, 99)).toBe(false);
  });
});
