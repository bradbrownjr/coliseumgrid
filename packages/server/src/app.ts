// The Fastify app, built by a function so tests can use app.inject without a socket.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { createAccess, rejectForeignOrigin } from './access.ts';
import { registerBracketRoutes } from './bracket-routes.ts';
import { createBracketStore } from './bracket-store.ts';
import type { Clock } from './clock.ts';
import { createCompetition } from './competition.ts';
import type { Mode } from './config.ts';
import { openDatabase, type Database } from './database.ts';
import { createDevices } from './devices.ts';
import { createEventPlayers } from './event-players.ts';
import { createEvents } from './events.ts';
import { createFollowCodes } from './follow-codes.ts';
import { registerHostRoutes } from './host-routes.ts';
import { registerHeatRoutes } from './heat-routes.ts';
import { createHeatStore } from './heat-store.ts';
import { createHostStore } from './host-store.ts';
import { createLiveHub } from './live.ts';
import { registerNameTagRoutes } from './name-tag-routes.ts';
import { systemNetwork, type NetworkSource } from './network-addresses.ts';
import { startPhonePurge } from './phone-purge.ts';
import { createPhones } from './phones.ts';
import { registerPhoneRoutes } from './phone-routes.ts';
import { createPinGuard } from './pin-guard.ts';
import { createPlayers } from './players.ts';
import { registerPlayerRoutes } from './players-routes.ts';
import { createPush, type PushOptions } from './push-notify.ts';
import { createPushSubscriptions } from './push-subscriptions.ts';
import { createJoinLimits } from './rate-limit.ts';
import { startTagPinWipe } from './tag-pin-wipe.ts';
import { createTagQueue } from './tag-queue.ts';
import { createWriteChain } from './write-chain.ts';

export interface AppOptions {
  /** The built client (packages/client/dist), absolute or relative to the working directory. When it has no index.html, only /api is served. */
  clientDist?: string;
  /** Logs warnings and errors (Fastify's pino logger) when true. */
  logger?: boolean;
  /** The database. The app closes it when the app closes. Defaults to a private in-memory one, which tests use. */
  db?: Database;
  /**
   * The data folder (DATA_DIR); uploaded graphics go in its `graphics` folder. Defaults to a
   * private temporary folder that is deleted when the app closes, which tests use.
   */
  dataDir?: string;
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
  /**
   * Web Push (docs/PLAN.md, "Player view"). It is on only in online mode with a `subject`, and a
   * request must also come over HTTPS. `dataDir` is where the VAPID key file lives; `loadKeys` and
   * `send` stand in for the key file and the sender in tests.
   */
  push?: PushOptions;
  /** Called each time the phones' answer is built rather than read from the kept one. For tests. */
  onAnswerBuilt?: () => void;
  /** The network interfaces and default route behind GET /api/host/addresses. Tests stand in for them. Default the system's. */
  network?: NetworkSource;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Resolves when no push check or send is running or waiting. For tests. */
    pushIdle(): Promise<void>;
  }
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
  const tempDir = options.dataDir === undefined ? mkdtempSync(join(tmpdir(), 'coliseumgrid-')) : undefined;
  const dataDir = options.dataDir ?? (tempDir as string);
  const hub = createLiveHub(options.liveHeartbeatMs);
  app.addHook('onClose', () => {
    hub.stop();
    db.close();
    if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
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
  // leave the server unless it is added here too (CLAUDE.md, rule 1). `app` lets the offline
  // launcher tell ColiseumGrid from another program on the same port (launch.ts).
  app.get(
    '/api/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok'] },
              app: { type: 'string', enum: ['coliseumgrid'] },
            },
            required: ['status', 'app'],
            additionalProperties: false,
          },
        },
      },
    },
    () => ({ status: 'ok', app: 'coliseumgrid' }),
  );

  const hostStore = createHostStore(db, now);
  const devices = createDevices(db, now);
  const phones = createPhones(db, now);
  // Phones nobody used for 90 days go at startup and daily; one with a connection still open is cut off.
  const stopPurge = startPhonePurge(phones, (ids) => ids.forEach((id) => hub.signOutPhone(id)), (message) => app.log.warn(message));
  app.addHook('onClose', () => stopPurge());
  const access = await createAccess({
    mode,
    hostStore,
    devices,
    phones,
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
  const heatStore = createHeatStore(db);
  const competition = createCompetition(db, store, heatStore, players, events, options.onAnswerBuilt);
  const followCodes = createFollowCodes(db, now);
  const tags = createTagQueue(db, now, (message) => app.log.warn(message));
  // The print queue's news goes to host screens only (docs/PLAN.md, "Name tags API").
  const onTagsChanged = (): void => hub.broadcastToHosts({ type: 'tags' });
  // Plain PINs queued 12 hours ago go at startup and hourly; the tags stay.
  const stopPinWipe = startTagPinWipe(tags, onTagsChanged, (message) => app.log.warn(message));
  app.addHook('onClose', () => stopPinWipe());
  const pushSubscriptions = createPushSubscriptions(db, now);
  const pinGuard = createPinGuard(mode, now, (handleKey) => players.getByKey(handleKey)?.pinHash);
  // Wrong pairing codes and wrong follow codes count against the same limits.
  const joinLimits = createJoinLimits(now);
  const push = createPush({
    ...options.push,
    mode,
    competition,
    subscriptions: pushSubscriptions,
    warn: (message) => app.log.warn(message),
  });
  app.decorate('pushIdle', () => push.idle());
  // Every bracket and heats write, and a merge that could delete a player either is about to
  // take, goes through this one chain (docs/PLAN.md, "Brackets API", "Heats API").
  const chain = createWriteChain();

  await registerHostRoutes(app, {
    mode,
    access,
    devices,
    events,
    competition,
    hub,
    chain,
    now,
    joinLimits,
    tags,
    onEventChanged: () => competition.drop(),
    onTagsChanged,
    network: options.network ?? systemNetwork,
    ...(options.trustedProxy && { trustedProxy: options.trustedProxy }),
  });

  await registerPlayerRoutes(app, {
    players,
    eventPlayers,
    inBracket: (playerId) => {
      const eventId = events.currentId();
      return eventId !== null && competition.hasPlayer(eventId, playerId);
    },
    exclusive: (task) => chain.run(task),
    access,
    onPlayersChanged: () => hub.broadcast({ type: 'players' }),
    pinGuard,
    followCodes,
    phones,
    pushSubscriptions,
    onPhonesSignedOut: (phoneIds) => phoneIds.forEach((id) => hub.signOutPhone(id)),
    onCompetitionChanged: () => competition.drop(),
    tags,
    onTagsChanged,
    mode,
    ...(options.trustedProxy && { trustedProxy: options.trustedProxy }),
  });

  await registerPhoneRoutes(app, {
    access,
    phones,
    followCodes,
    pushSubscriptions,
    players,
    events,
    competition,
    hub,
    pinGuard,
    joinLimits,
    push,
    ...(options.trustedProxy && { trustedProxy: options.trustedProxy }),
  });

  await registerNameTagRoutes(app, {
    access,
    events,
    players,
    tags,
    hub,
    chain,
    graphicsDir: join(dataDir, 'graphics'),
    onEventChanged: () => competition.drop(),
    onTagsChanged,
  });

  await registerBracketRoutes(app, { access, events, eventPlayers, store, competition, hub, chain, now });
  await registerHeatRoutes(app, { access, events, eventPlayers, store: heatStore, competition, hub, chain, now });

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

  // Starts from the competition as it is, so a restart alerts nobody for what was already called.
  await push.start();

  return app;
}
