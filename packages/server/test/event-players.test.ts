// Who is in the current event (docs/PLAN.md, "Brackets API", "Who is in a bracket"), and the
// guard that keeps a player in a bracket from being merged away.

import type { Bracket } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { addPlayers, makeCallers, type Api } from './bracket-api-helpers.ts';

let app: FastifyInstance;
let db: Database;
let host: Api;
let signup: Api;

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = await buildApp({ db });
  ({ host, signup } = await makeCallers(app));
});
afterEach(() => app.close());

const inEvent = async (): Promise<number[]> => (await host('GET', '/api/event/players')).json().playerIds;
const signUp = async (handle: string, pin = '1234'): Promise<number> => {
  const res = await signup('POST', '/api/signup', { handle, pin });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().player.id;
};
const rows = (): Array<{ event_id: number; player_id: number }> =>
  db.prepare('SELECT event_id, player_id FROM event_players ORDER BY player_id').all() as never;

describe('GET /api/event/players', () => {
  it('is empty before any event exists and lists nobody until someone signs up', async () => {
    expect((await host('GET', '/api/event/players')).json()).toEqual({ playerIds: [] });
    await host('PUT', '/api/event', { name: 'Friday' });
    expect((await host('GET', '/api/event/players')).json()).toEqual({ playerIds: [] });
  });

  it('answers ids only', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    const id = await signUp('Zap');
    const res = await host('GET', '/api/event/players');
    expect(res.json()).toEqual({ playerIds: [id] });
    expect(res.body).not.toContain('Zap');
  });
});

describe('event_players', () => {
  it('gets a player who signs up on a tablet', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    const zap = await signUp('Zap');
    const bolt = await signUp('Bolt');
    expect(await inEvent()).toEqual([zap, bolt]);
    expect(rows().map((r) => r.event_id)).toEqual([1, 1]);
  });

  it('gets a player the host adds by hand', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    const res = await host('POST', '/api/players', { handle: 'Added' });
    expect(res.statusCode).toBe(201);
    expect(await inEvent()).toEqual([res.json().player.id]);
  });

  it('gets a returning player who claims their handle, once however often they claim', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    const zap = await signUp('Zap', '4321');
    // They signed up at an earlier event, so they are not in this one until they claim.
    db.prepare('DELETE FROM event_players').run();
    expect(await inEvent()).toEqual([]);

    const wrong = await signup('POST', '/api/signup/claim', { handle: 'Zap', pin: '0000' });
    expect(wrong.statusCode).toBe(401);
    expect(await inEvent()).toEqual([]);

    for (let i = 0; i < 2; i++) {
      const claimed = await signup('POST', '/api/signup/claim', { handle: 'zap', pin: '4321' });
      expect(claimed.statusCode).toBe(200);
    }
    expect(await inEvent()).toEqual([zap]);
    expect(rows()).toHaveLength(1);
  });

  it('gets nobody from a refused or taken sign-up, a check, or a failed claim', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    await signUp('Zap');
    db.prepare('DELETE FROM event_players').run();
    await signup('POST', '/api/signup', { handle: 'FUCK', pin: '1234' });
    await signup('POST', '/api/signup', { handle: 'zap', pin: '1234' });
    await signup('POST', '/api/signup', { handle: 'Fine', pin: 'abcd' });
    await signup('POST', '/api/signup/check', { handle: 'Other' });
    await signup('POST', '/api/signup/claim', { handle: 'Nobody', pin: '1234' });
    await host('POST', '/api/players', { handle: 'zap' });
    expect(await inEvent()).toEqual([]);
  });

  it('names an event when a player signs up before the host has, and keeps the host\'s name after', async () => {
    expect((await host('GET', '/api/event')).json()).toEqual({ event: null });
    const zap = await signUp('Zap');
    expect((await host('GET', '/api/event')).json()).toEqual({ event: { name: 'ColiseumGrid', game: null } });
    expect(await inEvent()).toEqual([zap]);
    // The host names it later: the same event, so Zap stays in it.
    await host('PUT', '/api/event', { name: 'Friday' });
    expect(await inEvent()).toEqual([zap]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 1 });
  });

  it('follows the newest event', async () => {
    await host('PUT', '/api/event', { name: 'First' });
    const zap = await signUp('Zap');
    db.prepare("INSERT INTO events (name, created_at) VALUES ('Second', 't')").run();
    expect(await inEvent()).toEqual([]);
    const bolt = await signUp('Bolt');
    expect(await inEvent()).toEqual([bolt]);
    expect(rows().map((r) => r.player_id)).toEqual([zap, bolt]);
  });

  it('gets the players the host picks for a bracket, and a late player, when nobody signed them up today', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    // Players from an earlier event: none of them is in this one.
    const [a, b, c, late] = addPlayers(db, 4) as [number, number, number, number];
    expect(await inEvent()).toEqual([]);
    const made = await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: [a, b, c] });
    expect(made.statusCode).toBe(201);
    expect(await inEvent()).toEqual([a, b, c]);
    const joined = await host('POST', '/api/bracket/players', { playerId: late });
    expect(joined.statusCode, joined.body).toBe(200);
    expect(await inEvent()).toEqual([a, b, c, late]);
  });

  it('gets nobody from a refused bracket or a refused late join', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    const [a, b, c, d, late] = addPlayers(db, 5) as [number, number, number, number, number];
    expect((await host('POST', '/api/bracket', { format: 'double', bestOf: 1, stations: 1, playerIds: [a, b] })).statusCode).toBe(400);
    expect(await inEvent()).toEqual([]);
    // Four players fill four slots, so no late player fits.
    expect((await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: [a, b, c, d] })).statusCode).toBe(201);
    expect((await host('POST', '/api/bracket/players', { playerId: late })).statusCode).toBe(409);
    expect(await inEvent()).toEqual([a, b, c, d]);
  });

  it('is removed with the player', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    const zap = await signUp('Zap');
    const bolt = await signUp('Bolt');
    db.prepare('DELETE FROM players WHERE id = ?').run(zap);
    expect(await inEvent()).toEqual([bolt]);
  });
});

describe('merging players', () => {
  const body = (intoId: number) => ({ intoId });

  it('moves the merged player\'s place in the event to the player kept', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    const away = await signUp('Away');
    // The player kept was not here today.
    const [kept] = addPlayers(db, 1) as [number];
    expect(await inEvent()).toEqual([away]);
    const res = await host('POST', `/api/players/${away}/merge`, body(kept));
    expect(res.statusCode).toBe(200);
    expect(await inEvent()).toEqual([kept]);
    expect(rows()).toHaveLength(1);
  });

  it('refuses to merge away a player in a running bracket, and changes nothing', async () => {
    const [a, b, c, d, e] = addPlayers(db, 5) as [number, number, number, number, number];
    const bracket = (await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: [a, b, c, d] })).json().bracket as Bracket;
    const before = (await host('GET', '/api/players')).json();
    const res = await host('POST', `/api/players/${a}/merge`, body(e));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'in-bracket' });
    expect((await host('GET', '/api/players')).json()).toEqual(before);
    expect((await host('GET', '/api/bracket')).json()).toEqual({ bracket });
  });

  it('refuses it for a finished bracket too, so the answer can always be made', async () => {
    const [a, b, c] = addPlayers(db, 3) as [number, number, number];
    let bracket = (await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: [a, b] })).json().bracket as Bracket;
    const match = bracket.stations[0]?.match;
    bracket = (await host('POST', '/api/bracket/results', { matchId: match?.id, winnerId: match?.slots[0].player?.id })).json().bracket;
    expect(bracket.finished).toBe(true);
    const res = await host('POST', `/api/players/${b}/merge`, body(c));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'in-bracket' });
    expect((await host('GET', '/api/bracket')).statusCode).toBe(200);
  });

  it('allows it when only the player kept is in the bracket, and once the bracket is deleted', async () => {
    const [a, b, c, d, e] = addPlayers(db, 5) as [number, number, number, number, number];
    await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: [a, b, c, d] });
    expect((await host('POST', `/api/players/${e}/merge`, body(a))).statusCode).toBe(200);
    expect((await host('POST', `/api/players/${b}/merge`, body(a))).statusCode).toBe(409);
    await host('DELETE', '/api/bracket');
    expect((await host('POST', `/api/players/${b}/merge`, body(a))).statusCode).toBe(200);
    expect((await host('GET', '/api/players')).json().players.map((p: { id: number }) => p.id)).toEqual([a, c, d]);
  });

  it('refuses a player who joined late, and answers 404 before 409 for a player who does not exist', async () => {
    const [a, b, c, d] = addPlayers(db, 4) as [number, number, number, number];
    await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 2, playerIds: [a, b, c] });
    expect((await host('POST', '/api/bracket/players', { playerId: d })).statusCode).toBe(200);
    expect((await host('POST', `/api/players/${d}/merge`, body(a))).json()).toEqual({ error: 'in-bracket' });
    expect((await host('POST', '/api/players/999/merge', body(a))).json()).toEqual({ error: 'not-found' });
    expect((await host('POST', `/api/players/${a}/merge`, body(999))).json()).toEqual({ error: 'not-found' });
  });
});
