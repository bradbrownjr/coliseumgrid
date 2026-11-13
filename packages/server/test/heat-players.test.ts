// Who is in the current event when heats are made, and the merge guard that keeps a player in
// the event's heats from being merged away (docs/PLAN.md, "Heats API", "One competition per
// event"; "Brackets API", "Who is in a bracket").

import type { Heats } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { addPlayers, makeCallers, type Api } from './bracket-api-helpers.ts';
import { heatsBody, makeHeats, playListed } from './heat-api-helpers.ts';

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

const inEvent = async (): Promise<number[]> => (await host('GET', '/api/event/players')).json().playerIds;
const merge = (id: number, intoId: number) => host('POST', `/api/players/${id}/merge`, { intoId });

describe('event_players', () => {
  it('gets the players the host picks for heats, and a late player, when nobody signed them up today', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    expect(await inEvent()).toEqual([]);
    await makeHeats(host, ids.slice(0, 10));
    expect(await inEvent()).toEqual(ids.slice(0, 10));
    const joined = await host('POST', '/api/heats/players', { playerId: ids[10] });
    expect(joined.statusCode, joined.body).toBe(200);
    expect(await inEvent()).toEqual(ids.slice(0, 11));
  });

  it('names an event when heats are made before the host has named one', async () => {
    expect((await host('GET', '/api/event')).json()).toEqual({ event: null });
    await makeHeats(host, ids.slice(0, 5));
    expect((await host('GET', '/api/event')).json()).toEqual({ event: { name: 'ColiseumGrid' } });
    expect(await inEvent()).toEqual(ids.slice(0, 5));
  });

  it('gets nobody from refused heats or a refused late join', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    expect((await host('POST', '/api/heats', heatsBody(ids.slice(0, 1)))).statusCode).toBe(400);
    expect((await host('POST', '/api/heats', { ...heatsBody(ids.slice(0, 5)), rounds: 9 })).statusCode).toBe(400);
    expect((await host('POST', '/api/heats', heatsBody([...ids.slice(0, 4), 9999]))).statusCode).toBe(400);
    expect(await inEvent()).toEqual([]);
    // Six players on two stations: both heats are called, so no late player fits.
    await makeHeats(host, ids.slice(0, 6), { stations: 2 });
    expect((await host('POST', '/api/heats/players', { playerId: ids[6] })).statusCode).toBe(409);
    expect((await host('POST', '/api/heats/players', { playerId: ids[0] })).statusCode).toBe(409);
    expect((await host('POST', '/api/heats/players', { playerId: 9999 })).statusCode).toBe(404);
    expect(await inEvent()).toEqual(ids.slice(0, 6));
  });
});

describe('merging players', () => {
  it('refuses to merge away a player in heats being played, and changes nothing', async () => {
    const heats = await makeHeats(host, ids.slice(0, 5));
    const before = (await host('GET', '/api/players')).json();
    const res = await merge(ids[0] as number, ids[9] as number);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'in-bracket' });
    expect((await host('GET', '/api/players')).json()).toEqual(before);
    expect((await host('GET', '/api/heats')).json()).toEqual({ heats });
  });

  it('refuses it for finished heats too, so the answer can always be made', async () => {
    const heats = await playListed(host, await makeHeats(host, ids.slice(0, 3)));
    expect(heats.finished).toBe(true);
    const res = await merge(ids[1] as number, ids[9] as number);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'in-bracket' });
    expect((await host('GET', '/api/heats')).statusCode).toBe(200);
  });

  it('refuses a player who joined late, and answers 404 before 409 for a player who does not exist', async () => {
    await makeHeats(host, ids.slice(0, 10));
    expect((await host('POST', '/api/heats/players', { playerId: ids[10] })).statusCode).toBe(200);
    expect((await merge(ids[10] as number, ids[0] as number)).json()).toEqual({ error: 'in-bracket' });
    expect((await merge(999, ids[0] as number)).json()).toEqual({ error: 'not-found' });
    expect((await merge(ids[0] as number, 999)).json()).toEqual({ error: 'not-found' });
  });

  it('allows it when only the player kept is in the heats, and once the heats are deleted', async () => {
    await makeHeats(host, ids.slice(0, 5));
    expect((await merge(ids[9] as number, ids[0] as number)).statusCode).toBe(200);
    expect((await merge(ids[1] as number, ids[0] as number)).statusCode).toBe(409);
    await host('DELETE', '/api/heats');
    expect((await merge(ids[1] as number, ids[0] as number)).statusCode).toBe(200);
    const left = ((await host('GET', '/api/players')).json().players as { id: number }[]).map((p) => p.id);
    expect(left).not.toContain(ids[1]);
    expect(left).not.toContain(ids[9]);
  });

  it('allows it again when a bracket replaced the finished heats', async () => {
    await playListed(host, await makeHeats(host, ids.slice(0, 3)));
    expect((await merge(ids[1] as number, ids[9] as number)).statusCode).toBe(409);
    const made = await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: [ids[5], ids[6]] });
    expect(made.statusCode).toBe(201);
    // The heats are gone, so their players are free; the bracket's are not.
    expect((await merge(ids[1] as number, ids[9] as number)).statusCode).toBe(200);
    expect((await merge(ids[5] as number, ids[9] as number)).json()).toEqual({ error: 'in-bracket' });
  });

  it('does not guard a player whose heats belong to an earlier event', async () => {
    await makeHeats(host, ids.slice(0, 5));
    db.prepare("INSERT INTO events (name, created_at) VALUES ('Next', 't')").run();
    // The guard looks at the current event only.
    expect((await merge(ids[0] as number, ids[9] as number)).statusCode).toBe(200);
  });
});

describe('a heats answer after a merge', () => {
  it('can always be made, because a player in the heats is never merged away', async () => {
    const heats: Heats = await makeHeats(host, ids.slice(0, 5));
    for (const id of ids.slice(0, 5)) expect((await merge(id, ids[13] as number)).statusCode).toBe(409);
    expect((await host('GET', '/api/heats')).json().heats).toEqual(heats);
  });
});
