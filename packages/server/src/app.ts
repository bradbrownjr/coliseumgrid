// The Fastify app, built by a function so tests can use app.inject without a socket.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { createAccess, rejectForeignOrigin } from './access.ts';
import { registerBracketRoutes } from './bracket-routes.ts';
import { createBracketStore } from './bracket-store.ts';
import type { Clock } from './clock.ts';
import type { Mode } from './config.ts';
import { openDatabase, type Database } from './database.ts';
import { createDevices } from './devices.ts';
import { createEventPlayers } from './event-players.ts';
import { createEvents } from './events.ts';
import { registerHostRoutes } from './host-routes.ts';
import { createHostStore } from './host-store.ts';
import { createLiveHub } from './live.ts';
import { createPlayers } from './players.ts';
import { registerPlayerRoutes } from './players-routes.ts';
import { createWriteChain } from './write-chain.ts';

export interface AppOptions {
  /** The built client (packages/client/dist), absolute or relative to the working directory. When it has no index.html, only /api is served. */
  clientDist?: string;
  /** Logs warnings and errors (Fastify's pino logger) when true. */
  logger?: boolean;
  /** The database. The app closes it when the app closes. Defaults to a private in-memory one, which tests use. */
  db?: Database;
  /** Online adds the rate limits on PIN guessing (docs/PLAN.md, section 8). Default offline. */
  mode?: Mode;
  /** The reverse proxy's address, the only peer whose X-Forwarded-For is read (CLAUDE.md, rule 6). */
  trustedProxy?: string;
  /** The host password from COLISEUMGRID_HOST_PASSWORD. When set it is the password and first-run setup is off. Online mode requires it. */
  hostPassword?: string;
  /** The clock for expiry and rate-limit windows. Tests move it by hand. Default Date.now. */
  now?: Clock;
  /** Ping interval for live connections, in milliseconds. Tests shorten it. Default HEARTBEAT_MS. */
  liveHeartbeatMs?: number;
}

/** `/api` and everything under it belongs to the API, never to the client. */
function isApiPath(url: string): boolean {
  const path = url.split('?', 1)[0] ?? '';
  return path === '/api' || path.startsWith('/api/');
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ? { level: 'warn' } : false,
    // Fastify's defaults coerce types and silently drop unknown fields. Here a PIN sent as a
    // number is a bad request, and so is a field the contract doesn't list.
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });

  const mode = options.mode ?? 'offline';
  // Online has no localhost sign-in and no first-run setup, so without a password the host
  // screens could never be opened (docs/PLAN.md, "Host sign-in").
  if (mode === 'online' && !options.hostPassword) {
    throw new Error('Online mode needs a host password (COLISEUMGRID_HOST_PASSWORD).');
  }
  const now = options.now ?? Date.now;

  const db = options.db ?? openDatabase(':memory:');
  const hub = createLiveHub(options.liveHeartbeatMs);
  app.addHook('onClose', () => {
    hub.stop();
    db.close();
  });

  // Clients get a code, never Fastify's message text (docs/PLAN.md, "Players API").
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (error.validation || status === 400) return reply.code(400).send({ error: 'bad-request' });
    if (status === 429) return reply.code(429).send({ error: 'too-many-tries' });
    if (status < 500) return reply.code(status).send({ error: 'bad-request' });
    request.log.error(error);
    return reply.code(500).send({ error: 'server-error' });
  });

  // A request that changes something must come from our own pages. SameSite=Strict doesn't
  // cover a page on another port of the same address, or on a sibling subdomain, and a POST
  // with no body needs no CORS preflight, so the check is on Origin for every method that can
  // change state. GET (including the /api/live handshake, which checks Origin itself) reads only.
  app.addHook('onRequest', async (request, reply) =>
    request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS'
      ? undefined
      : rejectForeignOrigin(request, reply),
  );

  // The response schema lists each field, so a field added to the handler later can't
  // leave the server unless it is added here too (CLAUDE.md, rule 1).
  app.get(
    '/api/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { status: { type: 'string', enum: ['ok'] } },
            required: ['status'],
            additionalProperties: false,
          },
        },
      },
    },
    () => ({ status: 'ok' }),
  );

  const hostStore = createHostStore(db, now);
  const devices = createDevices(db, now);
  const access = await createAccess({
    mode,
    hostStore,
    devices,
    ...(options.hostPassword && { hostPassword: options.hostPassword }),
    ...(options.trustedProxy && { trustedProxy: options.trustedProxy }),
  });

  // Registered before any route, because it adds a hook that sees each route as it is added.
  // maxPayload: clients send the server nothing, so even a small message is refused (the
  // library's default is 100 MiB).
  await app.register(fastifyWebsocket, { options: { maxPayload: 1024 } });

  const events = createEvents(db, now);
  const players = createPlayers(db);
  const eventPlayers = createEventPlayers(db, events, (event) => hub.broadcast({ type: 'event', event }));
  const store = createBracketStore(db);
  // Every bracket write, and a merge that could delete a player a bracket is about to take,
  // goes through this one chain (docs/PLAN.md, "Brackets API").
  const chain = createWriteChain();

  await registerHostRoutes(app, {
    access,
    devices,
    events,
    hub,
    now,
    ...(options.trustedProxy && { trustedProxy: options.trustedProxy }),
  });

  await registerPlayerRoutes(app, {
    players,
    eventPlayers,
    inBracket: (playerId) => {
      const eventId = events.currentId();
      return eventId !== null && store.hasPlayer(eventId, playerId);
    },
    exclusive: (task) => chain.run(task),
    access,
    onPlayersChanged: () => hub.broadcast({ type: 'players' }),
    mode,
    ...(options.trustedProxy && { trustedProxy: options.trustedProxy }),
  });

  await registerBracketRoutes(app, { access, players, events, eventPlayers, store, hub, chain, now });

  // @fastify/static throws on a relative root while existsSync accepts one, so resolve it here
  // (against the working directory) in the factory rather than in each caller.
  const clientDist = options.clientDist === undefined ? undefined : resolve(options.clientDist);
  const hasClient = clientDist !== undefined && existsSync(`${clientDist}/index.html`);
  if (hasClient) {
    await app.register(fastifyStatic, { root: clientDist });
  }

  app.setNotFoundHandler((request, reply) => {
    // Client routes (/host, /display) have no file behind them, so the client's router
    // gets index.html. An unknown API path must stay a JSON 404 so a typo doesn't look
    // like a working page.
    if (hasClient && (request.method === 'GET' || request.method === 'HEAD') && !isApiPath(request.url)) {
      return reply.sendFile('index.html', { maxAge: 0, immutable: false });
    }
    return reply.code(404).send({ error: 'not-found' });
  });

  return app;
}
