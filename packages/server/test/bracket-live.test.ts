// The { type: "bracket" } live message (docs/PLAN.md, "Brackets API", "Live"). Like live.test.ts,
// it uses injectWS, which runs the real upgrade over in-memory streams, so no port is opened.

import type { Bracket, LiveMessage } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { addPlayers, makeCallers, onStations, type Api } from './bracket-api-helpers.ts';

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

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = await buildApp({ db });
  await app.ready();
  ({ host, display, signup, nobody } = await makeCallers(app));
  ids = addPlayers(db, 8);
});
afterEach(async () => {
  for (const ws of open.splice(0)) ws.terminate();
  await app.close();
});

const brackets = (messages: LiveMessage[]) => messages.filter((m) => m.type === 'bracket');

describe('{ type: "bracket" }', () => {
  it('is sent once after each change to the bracket, to the host, a Display, and a Sign-up device', async () => {
    // The laptop is the host; each device pairs for its own cookie.
    const hostMessages = await listen(undefined, '127.0.0.1');
    const displayMessages = await listen(await deviceCookie('display'), '198.51.100.7');
    const signupMessages = await listen(await deviceCookie('signup'), '198.51.100.7');

    const made = (await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 2, playerIds: ids.slice(0, 4) })).json()
      .bracket as Bracket;
    const first = onStations(made)[0];
    const result = (await host('POST', '/api/bracket/results', { matchId: first?.id, winnerId: first?.slots[0].player?.id })).json();
    await host('POST', '/api/bracket/undo', { resultId: result.resultId });
    await host('DELETE', '/api/bracket');
    await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 3) });
    await host('POST', '/api/bracket/players', { playerId: ids[3] });
    await host('DELETE', '/api/bracket');
    await host('POST', '/api/bracket', { format: 'round_robin', bestOf: 1, stations: 1, playerIds: ids.slice(0, 3) });
    await host('POST', '/api/bracket/tie-break'); // no tie: refused, so no message

    // create, result, undo, delete, create, late join, delete, create = 8 changes.
    for (const messages of [hostMessages, displayMessages, signupMessages]) {
      await vi.waitFor(() => expect(brackets(messages)).toHaveLength(8));
      expect(brackets(messages).every((m) => JSON.stringify(m) === '{"type":"bracket"}')).toBe(true);
    }
  });

  it('is not sent for a read, a refusal, a delete with nothing to delete, or a caller who is not allowed', async () => {
    const messages = await listen(undefined, '127.0.0.1');
    await host('GET', '/api/bracket');
    await host('GET', '/api/event/players');
    await host('DELETE', '/api/bracket');
    await host('POST', '/api/bracket/results', { matchId: 0, winnerId: ids[0] });
    await host('POST', '/api/bracket/undo', { resultId: 1 });
    await host('POST', '/api/bracket/players', { playerId: ids[0] });
    await host('POST', '/api/bracket/tie-break');
    await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: [ids[0]] });
    await host('POST', '/api/bracket', { format: 'swiss' });
    await display('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 4) });
    await signup('DELETE', '/api/bracket');
    await nobody('POST', '/api/bracket/tie-break');
    // A marker proves the connection was alive and in order, so silence means no message.
    await host('PUT', '/api/event', { name: 'Marker' });
    await vi.waitFor(() => expect(messages.some((m) => m.type === 'event' && m.event?.name === 'Marker')).toBe(true));
    expect(brackets(messages)).toEqual([]);
  });

  it('is not sent when a running bracket refuses a second one', async () => {
    const messages = await listen(undefined, '127.0.0.1');
    const body = { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 4) };
    await host('POST', '/api/bracket', body);
    expect((await host('POST', '/api/bracket', body)).statusCode).toBe(409);
    await host('PUT', '/api/event', { name: 'Marker' });
    await vi.waitFor(() => expect(messages.some((m) => m.type === 'event' && m.event?.name === 'Marker')).toBe(true));
    expect(brackets(messages)).toHaveLength(1);
  });
});

/** Pairs a fresh device and returns its cookie. */
async function deviceCookie(role: 'display' | 'signup'): Promise<string> {
  const code = (await host('POST', '/api/pairing/codes', { role })).json().code as string;
  const joined = await app.inject({ method: 'POST', url: '/api/devices/join', payload: { code }, remoteAddress: '198.51.100.7' });
  const header = joined.headers['set-cookie'];
  return ((Array.isArray(header) ? header[0] : header) as string).split(';')[0] as string;
}
