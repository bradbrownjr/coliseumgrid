// A browser attaches the Origin of the page that sends a request. SameSite=Strict keeps another
// site from riding the host's cookie, but a page on another port of the same address, or on a
// sibling subdomain, is the same site, so the server also compares Origin with Host
// (docs/DEVELOPMENT.md, "Host and device sessions").

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { HOST_PASSWORD, REMOTE, signInHost } from './helpers.ts';

let app: FastifyInstance;
let host = '';
let db: Database;

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = await buildApp({ db, hostPassword: HOST_PASSWORD });
  host = await signInHost(app);
});
afterEach(() => app.close());

const HOST_HEADER = '10.6.26.2:3000';
const SAME_ORIGIN = 'http://10.6.26.2:3000';
const OTHER_PORT = 'http://10.6.26.2:8080';

function send(method: 'GET' | 'POST' | 'DELETE', url: string, origin: string | undefined, payload?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: REMOTE,
    headers: { cookie: host, host: HOST_HEADER, ...(origin !== undefined && { origin }) },
    ...(payload && { payload }),
  });
}

async function addPlayer(): Promise<number> {
  const res = await send('POST', '/api/signup', undefined, { handle: 'Zap', pin: '4321' });
  expect(res.statusCode).toBe(201);
  return res.json().player.id;
}

describe('a state-changing request from a page on another origin', () => {
  it('is refused for a POST with no body and no Content-Type, and changes nothing', async () => {
    const id = await addPlayer();
    const res = await send('POST', `/api/players/${id}/reset-pin`, OTHER_PORT);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
    // The PIN was not replaced.
    expect((await send('POST', '/api/signup/claim', undefined, { handle: 'Zap', pin: '4321' })).statusCode).toBe(200);
  });

  it('is refused for the bracket routes, which a page could otherwise delete or change with no body', async () => {
    const players = db.prepare("INSERT INTO players (handle, handle_key, pin_hash, created_at) VALUES (?, ?, 'x', 't')");
    const ids = ['Ann', 'Bo', 'Cy', 'Di'].map((h) => Number(players.run(h, h.toLowerCase()).lastInsertRowid));
    const body = { format: 'single', bestOf: 1, stations: 1, playerIds: ids };
    expect((await send('POST', '/api/bracket', OTHER_PORT, body)).statusCode).toBe(403);
    expect((await send('GET', '/api/bracket', undefined)).json()).toEqual({ bracket: null });
    expect((await send('POST', '/api/bracket', SAME_ORIGIN, body)).statusCode).toBe(201);
    for (const [method, url] of [['DELETE', '/api/bracket'], ['POST', '/api/bracket/tie-break']] as const) {
      const res = await send(method, url, OTHER_PORT);
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
    }
    expect((await send('GET', '/api/bracket', undefined)).json().bracket).not.toBeNull();
  });

  it('is refused for sign-out, and the session survives', async () => {
    const res = await send('POST', '/api/host/sign-out', OTHER_PORT);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
    expect((await send('GET', '/api/players', undefined)).statusCode).toBe(200);
  });

  it('is refused for a sibling subdomain, another port, and a different host', async () => {
    for (const origin of ['http://evil.10.6.26.2:3000', 'http://10.6.26.2', 'http://example.com']) {
      expect((await send('POST', '/api/host/sign-out', origin)).statusCode).toBe(403);
    }
  });

  it('is refused when Origin is "null" or not a URL', async () => {
    for (const origin of ['null', '', 'not a url', 'http://']) {
      expect((await send('POST', '/api/host/sign-out', origin)).statusCode).toBe(403);
    }
  });

  it('is refused for sign-in too, before the password is checked', async () => {
    const res = await send('POST', '/api/host/sign-in', OTHER_PORT, { password: HOST_PASSWORD });
    expect(res.statusCode).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it.each(['PUT', 'PATCH', 'DELETE'] as const)('is refused for %s', async (method) => {
    const res = await app.inject({
      method,
      url: '/api/event',
      remoteAddress: REMOTE,
      headers: { cookie: host, host: HOST_HEADER, origin: OTHER_PORT },
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('requests that are allowed', () => {
  it('passes a request from the same origin, whatever the case of the host name', async () => {
    const id = await addPlayer();
    expect((await send('POST', `/api/players/${id}/reset-pin`, SAME_ORIGIN)).statusCode).toBe(200);
    expect((await send('POST', '/api/host/sign-out', 'http://10.6.26.2:3000')).statusCode).toBe(204);
  });

  it('passes a request with no Origin, as a script or a tool sends it', async () => {
    const id = await addPlayer();
    expect((await send('POST', `/api/players/${id}/reset-pin`, undefined)).statusCode).toBe(200);
  });

  it('passes a request through an HTTPS proxy: https Origin with no port, Host without one', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/host/sign-out',
      remoteAddress: REMOTE,
      headers: { cookie: host, host: 'grid.example.com', origin: 'https://grid.example.com' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('does not look at Origin on a GET', async () => {
    expect((await send('GET', '/api/players', OTHER_PORT)).statusCode).toBe(200);
    expect((await send('GET', '/api/health', 'null')).statusCode).toBe(200);
  });
});
