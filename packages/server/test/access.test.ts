// Which routes each kind of caller may use (docs/PLAN.md, "Devices and host API"): the host
// routes need a host session, the sign-up routes a Sign-up device or a host session, and the
// laptop itself counts as the host offline. players.test.ts and rate-limit.test.ts test what
// the routes do; this file tests who gets in.

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { HOST_PASSWORD, pairDevice, REMOTE, signInHost, withCookie } from './helpers.ts';

let app: FastifyInstance;
let host: string;
let display: string;
let signup: string;

async function start(mode: 'offline' | 'online'): Promise<void> {
  app = await buildApp({ mode, hostPassword: HOST_PASSWORD });
  host = await signInHost(app);
  display = (await pairDevice(app, host, 'display')).cookie;
  signup = (await pairDevice(app, host, 'signup')).cookie;
}

afterEach(() => app.close());

interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  payload?: object;
}

const SIGNUP_ROUTES: Route[] = [
  { method: 'POST', url: '/api/signup/check', payload: { handle: 'Zap' } },
  { method: 'POST', url: '/api/signup', payload: { handle: 'Zap', pin: '1234' } },
  { method: 'POST', url: '/api/signup/claim', payload: { handle: 'Nobody', pin: '1234' } },
];

const HOST_ROUTES: Route[] = [
  { method: 'GET', url: '/api/players' },
  { method: 'POST', url: '/api/players', payload: { handle: 'Added' } },
  { method: 'PATCH', url: '/api/players/1', payload: { handle: 'Renamed' } },
  { method: 'POST', url: '/api/players/1/merge', payload: { intoId: 2 } },
  { method: 'POST', url: '/api/players/1/reset-pin' },
  { method: 'POST', url: '/api/bracket', payload: { format: 'single', bestOf: 1, stations: 1, playerIds: [1, 2] } },
  { method: 'POST', url: '/api/bracket/results', payload: { matchId: 0, winnerId: 1 } },
  { method: 'POST', url: '/api/bracket/undo', payload: { resultId: 1 } },
  { method: 'POST', url: '/api/bracket/players', payload: { playerId: 1 } },
  { method: 'POST', url: '/api/bracket/tie-break' },
  { method: 'DELETE', url: '/api/bracket' },
  { method: 'GET', url: '/api/event/players' },
];

// Any paired device may look; only the host changes things.
const DEVICE_ROUTES: Route[] = [{ method: 'GET', url: '/api/bracket' }];

/** Answers for a route as a caller sees them: 401 not-signed-in, or something else. */
async function status(route: Route, cookie: string | undefined, remoteAddress = REMOTE) {
  const res = await app.inject({
    method: route.method,
    url: route.url,
    remoteAddress,
    ...(route.payload && { payload: route.payload }),
    ...(cookie && { headers: { cookie } }),
  });
  if (res.statusCode === 401) expect(res.json(), `${route.method} ${route.url}`).toEqual({ error: 'not-signed-in' });
  return res.statusCode;
}

describe.each(['offline', 'online'] as const)('in %s mode', (mode) => {
  beforeEach(() => start(mode));

  it('refuses every protected route to a caller with no sign-in', async () => {
    for (const route of [...SIGNUP_ROUTES, ...HOST_ROUTES]) {
      expect(await status(route, undefined), `${route.method} ${route.url}`).toBe(401);
    }
  });

  it('refuses every protected route to a made-up or stale cookie', async () => {
    for (const cookie of ['cg_host=garbage', 'cg_device=garbage', 'cg_host=; cg_device=']) {
      for (const route of [...SIGNUP_ROUTES, ...HOST_ROUTES]) {
        expect(await status(route, cookie), `${cookie} ${route.url}`).toBe(401);
      }
    }
  });

  it('lets a Display and a Sign-up device read the bracket, and a stranger not', async () => {
    for (const route of DEVICE_ROUTES) {
      expect(await status(route, display), route.url).toBe(200);
      expect(await status(route, signup), route.url).toBe(200);
      expect(await status(route, host), route.url).toBe(200);
      expect(await status(route, undefined), route.url).toBe(401);
    }
  });

  it('lets a Sign-up device use the sign-up routes and nothing else', async () => {
    for (const route of SIGNUP_ROUTES) expect(await status(route, signup), route.url).not.toBe(401);
    for (const route of HOST_ROUTES) expect(await status(route, signup), route.url).toBe(401);
  });

  it('refuses a Display both the sign-up routes and the host routes', async () => {
    for (const route of [...SIGNUP_ROUTES, ...HOST_ROUTES]) expect(await status(route, display), route.url).toBe(401);
  });

  it('lets a host session use both', async () => {
    for (const route of [...SIGNUP_ROUTES, ...HOST_ROUTES]) expect(await status(route, host), route.url).not.toBe(401);
  });

  it('lets a browser that is both a Display and the host use the host routes', async () => {
    for (const route of HOST_ROUTES) expect(await status(route, `${display}; ${host}`), route.url).not.toBe(401);
  });

  it('treats an unpaired device like a stranger', async () => {
    const devices = (await withCookie(app, host, { url: '/api/devices' })).json().devices as { id: number; role: string }[];
    const signupDevice = devices.find((device) => device.role === 'signup');
    await withCookie(app, host, { method: 'DELETE', url: `/api/devices/${signupDevice?.id}` });
    for (const route of SIGNUP_ROUTES) expect(await status(route, signup), route.url).toBe(401);
  });

  it('keeps the health check and unknown paths open', async () => {
    expect((await app.inject({ url: '/api/health', remoteAddress: REMOTE })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/nope', remoteAddress: REMOTE })).statusCode).toBe(404);
  });

  it('keeps the pairing, session, and device-info routes open to a caller with no sign-in', async () => {
    for (const url of ['/api/host/session', '/api/devices/me']) {
      const res = await app.inject({ url, remoteAddress: REMOTE });
      expect(res.statusCode, url).not.toBe(404);
    }
  });

  it('answers 401 before it reads the body, so an unauthenticated caller learns nothing about the schema', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/players', payload: { nonsense: true }, remoteAddress: REMOTE });
    expect(res.statusCode).toBe(401);
  });
});

describe('offline: the laptop itself is the host', () => {
  beforeEach(() => start('offline'));

  it('may use every route with no cookie', async () => {
    for (const route of [...SIGNUP_ROUTES, ...HOST_ROUTES]) {
      expect(await status(route, undefined, '127.0.0.1'), route.url).not.toBe(401);
    }
    for (const address of ['::1', '::ffff:127.0.0.1']) {
      expect(await status(HOST_ROUTES[0] as Route, undefined, address), address).toBe(200);
    }
  });

  it('is not extended to another address on the laptop network', async () => {
    for (const address of ['192.168.1.5', '10.6.26.3', '127.0.0.2']) {
      expect(await status(HOST_ROUTES[0] as Route, undefined, address), address).toBe(401);
    }
  });
});

describe('online: the laptop address is nobody special', () => {
  beforeEach(() => start('online'));

  it('refuses every protected route to a request from localhost with no sign-in', async () => {
    for (const route of [...SIGNUP_ROUTES, ...HOST_ROUTES]) {
      expect(await status(route, undefined, '127.0.0.1'), route.url).toBe(401);
    }
  });
});

// A page on a sibling subdomain, or another port of the same address, can set a second cookie
// of the same name with a narrower Path. A browser lists that one first, so a bogus value can
// sit in front of the real one.
describe('a repeated cookie name (cookie tossing)', () => {
  beforeEach(() => start('online'));

  const tossed = (cookie: string) => `${cookie.split('=')[0]}=bogus; ${cookie}`;

  it('finds the host session behind a bogus cg_host value', async () => {
    expect(await status(HOST_ROUTES[0] as Route, tossed(host))).toBe(200);
    expect(await status(HOST_ROUTES[0] as Route, `${host}; cg_host=bogus`)).toBe(200);
  });

  it('finds the device behind a bogus cg_device value', async () => {
    for (const cookie of [signup, display]) {
      const res = await app.inject({ url: '/api/devices/me', remoteAddress: REMOTE, headers: { cookie: tossed(cookie) } });
      expect(res.statusCode).toBe(200);
    }
    expect(await status(SIGNUP_ROUTES[0] as Route, tossed(signup))).toBe(200);
  });

  it('still refuses when every value is bogus', async () => {
    expect(await status(HOST_ROUTES[0] as Route, 'cg_host=bogus; cg_host=worse')).toBe(401);
    expect(await status(SIGNUP_ROUTES[0] as Route, 'cg_device=bogus; cg_device=worse')).toBe(401);
  });

  it('signs out the real session, not the bogus one in front of it', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/host/sign-out', remoteAddress: REMOTE, headers: { cookie: tossed(host) } });
    expect(res.statusCode).toBe(204);
    expect(await status(HOST_ROUTES[0] as Route, host)).toBe(401);
  });
});
