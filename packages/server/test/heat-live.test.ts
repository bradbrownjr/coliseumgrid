// The { type: "heats" } live message (docs/PLAN.md, "Heats API", "Live"). Like
// bracket-live.test.ts, it uses injectWS, which runs the real upgrade over in-memory streams, so
// no port is opened.

import type { Heats, LiveMessage } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { addPlayers, makeCallers, type Api } from './bracket-api-helpers.ts';
import { heatsBody, heatsOnStations } from './heat-api-helpers.ts';

let app: FastifyInstance;
let db: Database;
let host: Api;
let display: Api;
let signup: Api;
let nobody: Api;
let ids: number[];
const open: Array<{ terminate(): void }> = [];

interface WebSocketLike {
  on(event: 'message', listener: (data: Buffer) => void): unknown;
}

/** Connects with the cookie of a paired device, or none (the laptop). Returns the messages received so far. */
async function listen(cookie: string | undefined, remoteAddress: string): Promise<LiveMessage[]> {
  const messages: LiveMessage[] = [];
  const ws = await app.injectWS(
    '/api/live',
    { headers: { ...(cookie && { cookie }), host: 'localhost' }, socket: { remoteAddress } } as never,
    { onInit: (socket: WebSocketLike) => socket.on('message', (data) => messages.push(JSON.parse(data.toString()) as LiveMessage)) },
  );
  open.push(ws);
  return messages;
}

/** Pairs a fresh device and returns its cookie. */
async function deviceCookie(role: 'display' | 'signup'): Promise<string> {
  const code = (await host('POST', '/api/pairing/codes', { role })).json().code as string;
  const joined = await app.inject({ method: 'POST', url: '/api/devices/join', payload: { code }, remoteAddress: '198.51.100.7' });
  const header = joined.headers['set-cookie'];
  return ((Array.isArray(header) ? header[0] : header) as string).split(';')[0] as string;
}

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = await buildApp({ db });
  await app.ready();
  ({ host, display, signup, nobody } = await makeCallers(app));
  ids = addPlayers(db, 14);
});
afterEach(async () => {
  for (const ws of open.splice(0)) ws.terminate();
  await app.close();
});

const heatsMessages = (messages: LiveMessage[]) => messages.filter((m) => m.type === 'heats');
const bracketMessages = (messages: LiveMessage[]) => messages.filter((m) => m.type === 'bracket');
/** A marker proves the connection was alive and in order, so silence before it means no message. */
async function marker(messages: LiveMessage[]): Promise<void> {
  await host('PUT', '/api/event', { name: 'Marker' });
  await vi.waitFor(() => expect(messages.some((m) => m.type === 'event' && m.event?.name === 'Marker')).toBe(true));
}

describe('{ type: "heats" }', () => {
  it('is sent once after each change to the heats, to the host, a Display, and a Sign-up device', async () => {
    const hostMessages = await listen(undefined, '127.0.0.1');
    const displayMessages = await listen(await deviceCookie('display'), '198.51.100.7');
    const signupMessages = await listen(await deviceCookie('signup'), '198.51.100.7');

    const made = (await host('POST', '/api/heats', heatsBody(ids.slice(0, 10)))).json().heats as Heats;
    const first = heatsOnStations(made)[0];
    const result = (await host('POST', '/api/heats/results', { heatId: first?.id, order: first?.players.map((p) => p.id) })).json();
    await host('POST', '/api/heats/undo', { resultId: result.resultId });
    await host('POST', '/api/heats/players', { playerId: ids[10] });
    await host('DELETE', '/api/heats');
    await host('POST', '/api/heats', heatsBody(ids.slice(0, 10)));
    await host('POST', '/api/heats/tie-break'); // no tie: refused, so no message

    // create, result, undo, late join, delete, create = 6 changes.
    for (const messages of [hostMessages, displayMessages, signupMessages]) {
      await vi.waitFor(() => expect(heatsMessages(messages)).toHaveLength(6));
      expect(heatsMessages(messages).every((m) => JSON.stringify(m) === '{"type":"heats"}')).toBe(true);
      expect(bracketMessages(messages)).toEqual([]);
    }
  });

  it('is not sent for a read, a refusal, a delete with nothing to delete, or a caller who is not allowed', async () => {
    const messages = await listen(undefined, '127.0.0.1');
    await host('GET', '/api/heats');
    await host('DELETE', '/api/heats');
    await host('POST', '/api/heats/results', { heatId: 101, order: [ids[0], ids[1]] });
    await host('POST', '/api/heats/undo', { resultId: 1 });
    await host('POST', '/api/heats/players', { playerId: ids[0] });
    await host('POST', '/api/heats/tie-break');
    await host('POST', '/api/heats', { ...heatsBody([ids[0] as number]) });
    await host('POST', '/api/heats', { stations: 0 });
    await display('POST', '/api/heats', heatsBody(ids.slice(0, 5)));
    await signup('DELETE', '/api/heats');
    await nobody('POST', '/api/heats/tie-break');
    await marker(messages);
    expect(heatsMessages(messages)).toEqual([]);
  });

  it('is not sent when running heats refuse a second set, or a result for a heat that is not on a station', async () => {
    const messages = await listen(undefined, '127.0.0.1');
    const body = heatsBody(ids.slice(0, 10), { stations: 1 });
    const made = (await host('POST', '/api/heats', body)).json().heats as Heats;
    expect((await host('POST', '/api/heats', body)).statusCode).toBe(409);
    const waiting = made.upNext[0];
    expect((await host('POST', '/api/heats/results', { heatId: waiting?.id, order: waiting?.players.map((p) => p.id) })).statusCode).toBe(409);
    await marker(messages);
    expect(heatsMessages(messages)).toHaveLength(1);
  });

  it('is sent with a bracket message when finished heats are replaced by a bracket, and the other way', async () => {
    const messages = await listen(undefined, '127.0.0.1');
    const heats = (await host('POST', '/api/heats', heatsBody(ids.slice(0, 3)))).json().heats as Heats;
    const final = heatsOnStations(heats)[0];
    await host('POST', '/api/heats/results', { heatId: final?.id, order: final?.players.map((p) => p.id) });
    await vi.waitFor(() => expect(heatsMessages(messages)).toHaveLength(2));
    expect(bracketMessages(messages)).toEqual([]);

    // The heats are finished: a bracket takes their place, so screens showing heats reload too.
    const made = (await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 2) })).json().bracket;
    await vi.waitFor(() => expect(bracketMessages(messages)).toHaveLength(1));
    expect(heatsMessages(messages)).toHaveLength(3);
    const match = made.stations[0].match;
    await host('POST', '/api/bracket/results', { matchId: match.id, winnerId: match.slots[0].player.id });
    await vi.waitFor(() => expect(bracketMessages(messages)).toHaveLength(2));

    // And the finished bracket gives way to heats the same way.
    await host('POST', '/api/heats', heatsBody(ids.slice(0, 5)));
    await vi.waitFor(() => expect(heatsMessages(messages)).toHaveLength(4));
    expect(bracketMessages(messages)).toHaveLength(3);
  });
});
