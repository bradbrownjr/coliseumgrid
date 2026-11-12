// The Fastify app, built by a function so tests can use app.inject without a socket.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

export interface AppOptions {
  /** The built client (packages/client/dist), absolute or relative to the working directory. When it has no index.html, only /api is served. */
  clientDist?: string;
  /** Logs warnings and errors (Fastify's pino logger) when true. */
  logger?: boolean;
}

/** `/api` and everything under it belongs to the API, never to the client. */
function isApiPath(url: string): boolean {
  const path = url.split('?', 1)[0] ?? '';
  return path === '/api' || path.startsWith('/api/');
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ? { level: 'warn' } : false });

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
    return reply.code(404).send({ error: 'Not found' });
  });

  return app;
}
