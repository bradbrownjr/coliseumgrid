// The Fastify app, built by a function so tests can use app.inject without a socket.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Mode } from './config.ts';
import { openDatabase, type Database } from './database.ts';
import { createPlayers } from './players.ts';
import { registerPlayerRoutes } from './players-routes.ts';

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

  const db = options.db ?? openDatabase(':memory:');
  app.addHook('onClose', () => {
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

  await registerPlayerRoutes(app, {
    players: createPlayers(db),
    mode: options.mode ?? 'offline',
    ...(options.trustedProxy && { trustedProxy: options.trustedProxy }),
  });

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
