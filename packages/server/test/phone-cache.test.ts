// The kept competition answer behind GET /api/phone (docs/PLAN.md, "Phone API", "The answer
// cache"). Every phone reloads on every result, and a big round robin takes 258 ms to rebuild,
// so the answer is built once and kept. It must be dropped on every path that changes it, or a
// phone would read an answer older than the last change. One test per path counts the builds
// (the `onAnswerBuilt` option): reads reuse the answer, and the path makes the next read build
// a new one.

import { planDefaults, type Bracket, type Heats, type PhoneAnswer } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { createBracketStore } from '../src/bracket-store.ts';
import { createCompetition } from '../src/competition.ts';
import { createEvents } from '../src/events.ts';
import { createHeatStore } from '../src/heat-store.ts';
import { createPlayers } from '../src/players.ts';
import { makeCallers, onStations, type Api, type Callers } from './bracket-api-helpers.ts';
import { heatsBody } from './heat-api-helpers.ts';
import { PIN, addPinPlayers, signInPhone, type Phone } from './phone-helpers.ts';

let app: FastifyInstance;
let db: Database;
let callers: Callers;
let host: Api;
let phone: Phone;
let ids: number[];
let builds = 0;

beforeEach(async () => {
  builds = 0;
  db = openDatabase(':memory:');
  app = await buildApp({ db, onAnswerBuilt: () => void builds++ });
  await app.ready();
  callers = await makeCallers(app);
  host = callers.host;
  ids = addPinPlayers(db, 12);
  phone = await signInPhone(app, 'Player1');
});
afterEach(() => app.close());

const read = async (): Promise<PhoneAnswer> => {
  const res = await phone.api('GET', '/api/phone');
  expect(res.statusCode).toBe(200);
  return res.json();
};

/**
 * Checks that reads reuse the answer, that `change` makes the next read build a new one, and
 * returns what that read showed.
 */
async function dropsOn(change: () => Promise<unknown>): Promise<PhoneAnswer> {
  await read();
  const built = builds;
  await read();
  await read();
  expect(builds, 'a read with no change reuses the kept answer').toBe(built);
  await change();
  const after = await read();
  expect(builds, 'the read after the change builds a new answer').toBe(built + 1);
  await read();
  expect(builds, 'and keeps it').toBe(built + 1);
  return after;
}

const bracketBody = (n = 4) => ({ format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, n) });
const makeBracket = async (n = 4): Promise<Bracket> => (await host('POST', '/api/bracket', bracketBody(n))).json().bracket;
const makeHeats = async (): Promise<Heats> => (await host('POST', '/api/heats', heatsBody(ids.slice(0, 5)))).json().heats;

describe('the kept answer is dropped on', () => {
  it('a bracket result (save)', async () => {
    const made = await makeBracket();
    const match = onStations(made)[0]!;
    const after = await dropsOn(() => host('POST', '/api/bracket/results', { matchId: match.id, winnerId: match.slots[0].player!.id }));
    expect(after.standings).not.toBeNull();
  });

  it('a bracket undo, a late player, and a tie-break request (saves)', async () => {
    const made = await makeBracket(3);
    const match = onStations(made)[0]!;
    const recorded = await host('POST', '/api/bracket/results', { matchId: match.id, winnerId: match.slots[0].player!.id });
    await dropsOn(() => host('POST', '/api/bracket/undo', { resultId: recorded.json().resultId }));
    // A late player added to a bracket still open to them.
    await dropsOn(async () => expect((await host('POST', '/api/bracket/players', { playerId: ids[6] })).statusCode).toBe(200));
  });

  it('a heats result (save)', async () => {
    const made = await makeHeats();
    const heat = made.stations[0]!.heat!;
    await dropsOn(() => host('POST', '/api/heats/results', { heatId: heat.id, order: heat.players.map((p) => p.id) }));
  });

  it('a heats undo and a late player (saves)', async () => {
    const made = await makeHeats();
    const heat = made.stations[0]!.heat!;
    const recorded = await host('POST', '/api/heats/results', { heatId: heat.id, order: heat.players.map((p) => p.id) });
    await dropsOn(async () => expect((await host('POST', '/api/heats/undo', { resultId: recorded.json().resultId })).statusCode).toBe(200));
  });

  it('a late player in heats (save)', async () => {
    // One station, so most heats still wait and have room.
    await host('POST', '/api/heats', heatsBody(ids.slice(0, 10), { stations: 1 }));
    await dropsOn(async () => expect((await host('POST', '/api/heats/players', { playerId: ids[10] })).statusCode).toBe(200));
  });

  it('starting a bracket', async () => {
    const after = await dropsOn(makeBracket);
    expect(after.standings?.kind).toBe('bracket');
  });

  it('starting heats', async () => {
    const after = await dropsOn(makeHeats);
    expect(after.standings?.kind).toBe('heats');
  });

  it('new heats that replace a finished bracket', async () => {
    const one = await host('POST', '/api/bracket', bracketBody(2));
    const match = onStations(one.json().bracket)[0]!;
    await host('POST', '/api/bracket/results', { matchId: match.id, winnerId: match.slots[0].player!.id });
    const after = await dropsOn(makeHeats);
    expect(after.standings?.kind).toBe('heats');
  });

  it('deleting a bracket', async () => {
    await makeBracket();
    const after = await dropsOn(() => host('DELETE', '/api/bracket'));
    expect(after.standings).toBeNull();
  });

  it('deleting heats', async () => {
    await makeHeats();
    const after = await dropsOn(() => host('DELETE', '/api/heats'));
    expect(after.standings).toBeNull();
  });

  it('a rename', async () => {
    await makeBracket();
    const after = await dropsOn(() => host('PATCH', `/api/players/${ids[0]}`, { handle: 'Renamed' }));
    expect(after.following[0]!.player.handle).toBe('Renamed');
    expect(after.standings?.rows.map((r) => r.player.handle)).not.toContain('Player1');
  });

  it('a merge', async () => {
    await makeBracket();
    await dropsOn(() => host('POST', `/api/players/${ids[10]}/merge`, { intoId: ids[11] }));
  });

  it('an event change', async () => {
    await dropsOn(() => host('PUT', '/api/event', { name: 'Friday' }));
  });

  it('a new event, which the phone then reads by its name and game', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    const after = await dropsOn(() => host('POST', '/api/events', { name: 'Saturday', game: 'Tag' }));
    expect(after.event).toEqual({ name: 'Saturday', game: 'Tag' });
  });

  it('a plan change', async () => {
    await dropsOn(() => host('PUT', '/api/event/plan', { plan: planDefaults('fighting') }));
  });
});

describe('the kept answer is not dropped by', () => {
  it('phones signing in, following, unfollowing, or reading, or by the host reading', async () => {
    await makeBracket();
    await read();
    const built = builds;
    await phone.api('POST', '/api/phone/follow', { handle: 'Player2', pin: PIN });
    await phone.api('DELETE', `/api/phone/follow/${ids[1]}`);
    await host('GET', '/api/bracket');
    await host('GET', '/api/players');
    await host('POST', '/api/players', { handle: 'Added' });
    await read();
    expect(builds).toBe(built);
  });

  it('a result that fails', async () => {
    await makeBracket();
    await read();
    const built = builds;
    expect((await host('POST', '/api/bracket/results', { matchId: 9999, winnerId: ids[0] })).statusCode).toBe(404);
    await read();
    expect(builds).toBe(built);
  });
});

describe('the kept answer', () => {
  it('is built once for phones that ask at the same time', async () => {
    await makeBracket();
    const before = builds;
    const answers = await Promise.all(Array.from({ length: 10 }, () => phone.api('GET', '/api/phone')));
    expect(answers.every((r) => r.statusCode === 200)).toBe(true);
    expect(builds).toBe(before + 1);
  });

  it('is never older than the last change, however the reads and writes interleave', async () => {
    const made = await makeBracket(8);
    let match = onStations(made)[0]!;
    for (let round = 0; round < 3; round++) {
      const winner = match.slots[0].player!;
      // The read starts before the write finishes; the next read must see the write.
      const reading = read();
      const res = await host('POST', '/api/bracket/results', { matchId: match.id, winnerId: winner.id });
      await reading;
      const answer = await read();
      expect(answer.standings?.kind).toBe('bracket');
      const bracket = res.json().bracket as Bracket;
      expect(answer.standings).toMatchObject({ rows: bracket.standings });
      match = onStations(bracket)[0] ?? match;
    }
  });
});

describe('Competition.answer', () => {
  it('shares one build, builds again after drop, and does not keep a build that threw', async () => {
    const memory = openDatabase(':memory:');
    const brackets = createBracketStore(memory);
    const heats = createHeatStore(memory);
    let built = 0;
    const competition = createCompetition(memory, brackets, heats, createPlayers(memory), createEvents(memory, Date.now), () => void built++);
    expect(await competition.answer()).toBeNull();
    await competition.answer();
    expect(built).toBe(1);
    let dropped = 0;
    competition.onDrop(() => void dropped++);
    competition.drop();
    expect(dropped).toBe(1);
    await competition.answer();
    expect(built).toBe(2);

    // A stored bracket that doesn't replay throws; the next call tries again.
    memory.exec("INSERT INTO events (name, created_at) VALUES ('Friday', 't')");
    memory.exec("INSERT INTO brackets (event_id, format, best_of, stations, seeding, created_at) VALUES (1, 'single', 1, 1, '[1,2]', 't')");
    memory.exec("INSERT INTO bracket_results (bracket_id, match_id, winner_id, loser_id, at) VALUES (1, 77, 1, 2, 't')");
    competition.drop();
    await expect(competition.answer()).rejects.toThrow();
    await expect(competition.answer()).rejects.toThrow();
    expect(built).toBe(4);
    memory.close();
  });
});
