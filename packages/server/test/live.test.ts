// GET /api/live through @fastify/websocket's injectWS, which runs the real upgrade path
// (hooks, route, handler) over in-memory streams, so these tests open no port. Its README
// (node_modules/@fastify/websocket/README.md, "Testing") says to await app.ready() first and to
// close each socket at the end. injectWS builds the request from a plain object, so the tests
// give it the socket address a real connection would have.

import type { LiveMessage } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type AppOptions } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { HOST_SESSION_MS } from '../src/host-store.ts';
import { LAST_SEEN_THROTTLE_MS } from '../src/devices.ts';
import { HOST_PASSWORD, pairDevice, REMOTE, signInHost, withCookie } from './helpers.ts';

const START = Date.parse('2027-07-10T12:00:00Z');

let app: FastifyInstance;
let db: Database;
let clock = START;
let host = '';
const open: Connection[] = [];

/** The parts of the ws client the tests use. The ws types are not installed for this package. */
interface WebSocketLike {
  on(event: 'message', listener: (data: Buffer) => void): unknown;
  on(event: 'close', listener: (code: number) => void): unknown;
  on(event: 'ping', listener: (data: Buffer) => void): unknown;
  pong(data?: Buffer): void;
}

interface Connection {
  /** Messages received, in order. */
  messages: LiveMessage[];
  /** The close code, once the socket has closed. */
  closed: { code: number } | undefined;
  terminate(): void;
}

async function start(options: AppOptions = {}): Promise<void> {
  clock = START;
  db = openDatabase(':memory:');
  app = await buildApp({ db, now: () => clock, hostPassword: HOST_PASSWORD, ...options });
  await app.ready();
  host = await signInHost(app);
}

beforeEach(() => start());
afterEach(async () => {
  for (const connection of open.splice(0)) connection.terminate();
  await app.close();
});

async function connect(
  cookie: string | undefined,
  options: { remoteAddress?: string; host?: string; origin?: string; noPong?: boolean } = {},
): Promise<Connection> {
  const connection: Connection = { messages: [], closed: undefined, terminate: () => undefined };
  const upgradeContext = {
    headers: { ...(cookie && { cookie }), host: options.host ?? 'localhost', ...(options.origin !== undefined && { origin: options.origin }) },
    socket: { remoteAddress: options.remoteAddress ?? REMOTE },
  };
  const ws = await app.injectWS('/api/live', upgradeContext as never, {
    // Listeners go on before the upgrade finishes, so no early message is missed.
    onInit: (socket: WebSocketLike) => {
      socket.on('message', (data) => connection.messages.push(JSON.parse(data.toString()) as LiveMessage));
      socket.on('close', (code) => {
        connection.closed = { code };
      });
      // injectWS builds its client without autoPong, so a client that should answer pings has to.
      if (!options.noPong) socket.on('ping', (data) => socket.pong(data));
    },
  });
  connection.terminate = () => ws.terminate();
  open.push(connection);
  return connection;
}

const rejected = (cookie: string | undefined, options?: { remoteAddress?: string }) =>
  expect(connect(cookie, options)).rejects.toThrow(/401/);

const put = (name: string) => withCookie(app, host, { method: 'PUT', url: '/api/event', payload: { name } });

describe('who may connect', () => {
  it('refuses a connection with no cookie, a made-up cookie, or a stale one', async () => {
    await rejected(undefined);
    await rejected('cg_host=garbage');
    await rejected('cg_device=garbage');
    const { cookie, device } = await pairDevice(app, host, 'display');
    await withCookie(app, host, { method: 'DELETE', url: `/api/devices/${device.id}` });
    await rejected(cookie);
  });

  it('accepts the host, a Display, and a Sign-up device', async () => {
    const display = await pairDevice(app, host, 'display');
    const signup = await pairDevice(app, host, 'signup');
    for (const cookie of [host, display.cookie, signup.cookie]) {
      const connection = await connect(cookie);
      expect(connection.closed).toBeUndefined();
    }
  });

  it('accepts the laptop itself offline, with no cookie', async () => {
    const connection = await connect(undefined, { remoteAddress: '127.0.0.1' });
    expect(connection.closed).toBeUndefined();
  });

  it('does not accept localhost online without the password', async () => {
    await app.close();
    await start({ mode: 'online' });
    await rejected(undefined, { remoteAddress: '127.0.0.1' });
    expect(await connect(host, { remoteAddress: '127.0.0.1' })).toBeDefined();
  });

  it('does not accept a page from another site posing as the laptop', async () => {
    await expect(connect(undefined, { remoteAddress: '127.0.0.1', host: 'evil.example.com' })).rejects.toThrow(/401/);
  });
});

describe('the Origin of the handshake', () => {
  // A page on another origin (another port, a sibling subdomain) is the same site, so the host's
  // cookie would ride along; the handshake is refused before the socket opens.
  it.each(['http://10.6.26.2:8080', 'http://evil.10.6.26.2:3000', 'null', 'not a url', ''])(
    'refuses a handshake from the origin "%s"',
    async (origin) => {
      await expect(connect(host, { host: '10.6.26.2:3000', origin })).rejects.toThrow(/403/);
    },
  );

  it('accepts the page it serves, and a client that sends no Origin', async () => {
    expect((await connect(host, { host: '10.6.26.2:3000', origin: 'http://10.6.26.2:3000' })).closed).toBeUndefined();
    expect((await connect(host, { host: '10.6.26.2:3000' })).closed).toBeUndefined();
  });

  it('refuses a foreign origin even with no cookie, and does not tell it whether a sign-in exists', async () => {
    await expect(connect(undefined, { host: '10.6.26.2:3000', origin: 'http://10.6.26.2:8080' })).rejects.toThrow(/403/);
  });
});

describe('messages', () => {
  it('sends { type: "event", event } to a connected display within the same request that changes the event', async () => {
    const display = await pairDevice(app, host, 'display');
    const connection = await connect(display.cookie);
    expect((await put('Summer Showdown')).statusCode).toBe(200);
    // The message is queued before the PUT answers; waitFor covers only the in-memory stream hop.
    await vi.waitFor(() => expect(connection.messages).toEqual([{ type: 'event', event: { name: 'Summer Showdown', game: null } }]));
  });

  it('sends every change to every connection, host and devices alike', async () => {
    const display = await pairDevice(app, host, 'display');
    const signup = await pairDevice(app, host, 'signup');
    const connections = await Promise.all([connect(host), connect(display.cookie), connect(signup.cookie)]);
    await put('One');
    await put('Two');
    for (const connection of connections) {
      await vi.waitFor(() =>
        expect(connection.messages).toEqual([
          { type: 'event', event: { name: 'One', game: null } },
          { type: 'event', event: { name: 'Two', game: null } },
        ]),
      );
    }
  });

  it('sends nothing for a refused name', async () => {
    const display = await pairDevice(app, host, 'display');
    const connection = await connect(display.cookie);
    expect((await put('')).statusCode).toBe(400);
    await put('Marker');
    await vi.waitFor(() => expect(connection.messages).toEqual([{ type: 'event', event: { name: 'Marker', game: null } }]));
  });

  it('sends { type: "players" } after each change to the player list, and only then', async () => {
    const display = await pairDevice(app, host, 'display');
    const connection = await connect(display.cookie);
    const hostCall = (method: 'POST' | 'PATCH', url: string, payload?: object) =>
      withCookie(app, host, { method, url, ...(payload && { payload }) });

    // Sign-up from a tablet, a host add, a rename, and a merge each change the list. The first
    // sign-up also makes the event (nobody had named one), which screens hear about once.
    const tablet = await pairDevice(app, host, 'signup');
    const zap = (await withCookie(app, tablet.cookie, { method: 'POST', url: '/api/signup', payload: { handle: 'Zap', pin: '1234' } })).json().player;
    const bolt = (await hostCall('POST', '/api/players', { handle: 'Bolt' })).json().player;
    await hostCall('PATCH', `/api/players/${zap.id}`, { handle: 'Zapper' });
    await hostCall('POST', `/api/players/${bolt.id}/merge`, { intoId: zap.id });
    // These do not: a refused handle, a taken handle, a PIN reset, a claim, a check, a missing player.
    await withCookie(app, tablet.cookie, { method: 'POST', url: '/api/signup', payload: { handle: 'FUCK', pin: '1234' } });
    await withCookie(app, tablet.cookie, { method: 'POST', url: '/api/signup', payload: { handle: 'zapper', pin: '1234' } });
    await hostCall('POST', `/api/players/${zap.id}/reset-pin`);
    await withCookie(app, tablet.cookie, { method: 'POST', url: '/api/signup/claim', payload: { handle: 'Zapper', pin: '0000' } });
    await withCookie(app, tablet.cookie, { method: 'POST', url: '/api/signup/check', payload: { handle: 'New' } });
    await hostCall('PATCH', '/api/players/999', { handle: 'Nobody' });
    await put('End marker');

    await vi.waitFor(() =>
      expect(connection.messages).toEqual([
        { type: 'event', event: { name: 'ColiseumGrid', game: null } },
        { type: 'players' },
        { type: 'players' },
        { type: 'players' },
        { type: 'players' },
        { type: 'event', event: { name: 'End marker', game: null } },
      ]),
    );
  });

  it('never sends a message with a field outside the contract', async () => {
    const display = await pairDevice(app, host, 'display');
    const connection = await connect(display.cookie);
    await put('Names only');
    await withCookie(app, host, { method: 'POST', url: '/api/players', payload: { handle: 'Zap' } });
    await vi.waitFor(() => expect(connection.messages).toHaveLength(2));
    expect(JSON.stringify(connection.messages)).toBe('[{"type":"event","event":{"name":"Names only","game":null}},{"type":"players"}]');
  });
});

describe('unpairing', () => {
  it('sends { type: "unpaired" } and then closes the connection, and the token stops working', async () => {
    const display = await pairDevice(app, host, 'display');
    const other = await pairDevice(app, host, 'display');
    const connection = await connect(display.cookie);
    const bystander = await connect(other.cookie);

    const res = await withCookie(app, host, { method: 'DELETE', url: `/api/devices/${display.device.id}` });
    expect(res.statusCode).toBe(204);

    await vi.waitFor(() => expect(connection.closed).toBeDefined());
    expect(connection.messages).toEqual([{ type: 'unpaired' }]);
    expect(connection.closed?.code).toBe(1000);
    expect((await withCookie(app, display.cookie, { url: '/api/devices/me' })).statusCode).toBe(401);
    await rejected(display.cookie);
    // The other device is untouched and still gets updates.
    await put('Still here');
    await vi.waitFor(() => expect(bystander.messages).toEqual([{ type: 'event', event: { name: 'Still here', game: null } }]));
    expect(bystander.closed).toBeUndefined();
  });

  it('closes the old connection when a paired browser pairs again', async () => {
    const first = await pairDevice(app, host, 'display');
    const connection = await connect(first.cookie);
    const made = await withCookie(app, host, { method: 'POST', url: '/api/pairing/codes', payload: { role: 'signup' } });
    await withCookie(app, first.cookie, { method: 'POST', url: '/api/devices/join', payload: { code: made.json().code } });
    await vi.waitFor(() => expect(connection.closed).toBeDefined());
    expect(connection.messages).toEqual([{ type: 'unpaired' }]);
  });
});

describe('host sessions', () => {
  it('closes the host connection on sign-out', async () => {
    const connection = await connect(host);
    await withCookie(app, host, { method: 'POST', url: '/api/host/sign-out' });
    await vi.waitFor(() => expect(connection.closed).toBeDefined());
    expect(connection.closed?.code).toBe(1008);
  });

  it('closes a host connection at the next heartbeat after the 12-hour session ends', async () => {
    await app.close();
    await start({ liveHeartbeatMs: 20 });
    const connection = await connect(host);
    clock = START + HOST_SESSION_MS;
    await vi.waitFor(() => expect(connection.closed?.code).toBe(1008));
  });

  it('keeps a Display open when only the host session of the same browser ends', async () => {
    await app.close();
    await start({ liveHeartbeatMs: 20 });
    const display = await pairDevice(app, host, 'display');
    const connection = await connect(`${display.cookie}; ${host}`);
    clock = START + HOST_SESSION_MS;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(connection.closed).toBeUndefined();
  });
});

describe('the heartbeat', () => {
  it('keeps a connection that answers pings', async () => {
    await app.close();
    await start({ liveHeartbeatMs: 20 });
    const connection = await connect(host);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(connection.closed).toBeUndefined();
  });

  it('drops a connection that stops answering pings', async () => {
    await app.close();
    await start({ liveHeartbeatMs: 20 });
    const connection = await connect(host, { noPong: true });
    await vi.waitFor(() => expect(connection.closed).toBeDefined());
  });
});

describe('lastSeen on connect', () => {
  it('is set when a device connects, even inside the throttle period', async () => {
    const display = await pairDevice(app, host, 'display');
    clock = START + LAST_SEEN_THROTTLE_MS / 2;
    await connect(display.cookie);
    const devices = (await withCookie(app, host, { url: '/api/devices' })).json().devices;
    expect(devices[0].lastSeen).toBe(new Date(clock).toISOString());
  });
});
