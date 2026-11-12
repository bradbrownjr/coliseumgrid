// The players API (docs/PLAN.md, section 4, "Players API"). Each route lists the JSON schema
// of its body and of every status it answers with, so a field added to a handler later can't
// leave the server unless it is added here too (CLAUDE.md, rule 1).

import {
  checkHandle,
  isValidPin,
  suggestPin,
  type ApiError,
  type HandleBody,
  type HandlePinBody,
  type HandleRefusal,
  type MergeBody,
  type NewPlayerAnswer,
  type PinAnswer,
  type PlayerAnswer,
  type PlayersAnswer,
  type SignupCheckAnswer,
} from '@coliseumgrid/core';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getClientIp } from './client-ip.ts';
import type { Mode } from './config.ts';
import { hashPin, verifyPin } from './pin-hash.ts';
import type { Players } from './players.ts';
import {
  CLAIM_MAX_PER_IP,
  CLAIM_MAX_WRONG_PER_HANDLE,
  CLAIM_WINDOW_MS,
  FailureLimiter,
} from './rate-limit.ts';
import { secureRandom } from './secure-random.ts';

export interface PlayerRoutesOptions {
  players: Players;
  mode: Mode;
  /** See getClientIp. */
  trustedProxy?: string;
}

// Written as a Record so a reason added to core fails the type check until it is listed here.
const REFUSALS = Object.keys({
  'too-short': true,
  'too-long': true,
  'bad-characters': true,
  'not-allowed': true,
} satisfies Record<HandleRefusal, true>);

const playerSchema = {
  type: 'object',
  properties: { id: { type: 'integer' }, handle: { type: 'string' } },
  required: ['id', 'handle'],
  additionalProperties: false,
} as const;

const pinSchema = { type: 'string' } as const;

function errorSchema(codes: string[], withReason = false) {
  return {
    type: 'object',
    properties: {
      error: { type: 'string', enum: codes },
      ...(withReason && { reason: { type: 'string', enum: REFUSALS } }),
    },
    required: ['error'],
    additionalProperties: false,
  } as const;
}

function objectSchema(properties: Record<string, object>) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } as const;
}

// The id arrives as a string (Fastify is told not to coerce types, see app.ts), so the schema
// holds the digits check. Up to 15 digits stays a safe integer.
const idParams = objectSchema({ id: { type: 'string', pattern: '^[1-9][0-9]{0,14}$' } });

const handleBody = objectSchema({ handle: { type: 'string' } });
const handlePinBody = objectSchema({ handle: { type: 'string' }, pin: pinSchema });

const badRequest = errorSchema(['bad-request']);
const notFound = errorSchema(['not-found']);
const taken = errorSchema(['taken']);
const refusedOrBadRequest = errorSchema(['refused', 'bad-request'], true);

function fail(reply: FastifyReply, status: number, error: Exclude<ApiError['error'], 'refused'>): FastifyReply {
  return reply.code(status).send({ error } satisfies ApiError);
}

function refuse(reply: FastifyReply, reason: HandleRefusal): FastifyReply {
  return reply.code(400).send({ error: 'refused', reason } satisfies ApiError);
}

export async function registerPlayerRoutes(app: FastifyInstance, options: PlayerRoutesOptions): Promise<void> {
  const { players, trustedProxy } = options;
  const online = options.mode === 'online';

  // Failed PINs per handle, online only. Wrong PINs are counted here rather than by
  // @fastify/rate-limit because that counts requests, and a right PIN should cost nothing.
  const wrongPins = online ? new FailureLimiter(CLAIM_MAX_WRONG_PER_HANDLE, CLAIM_WINDOW_MS) : undefined;

  if (online) await app.register(rateLimit, { global: false });

  // Sign-up (tablet) ---------------------------------------------------------------------

  app.post<{ Body: HandleBody; Reply: SignupCheckAnswer | ApiError }>(
    '/api/signup/check',
    {
      schema: {
        body: handleBody,
        response: {
          200: {
            oneOf: [
              {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['available'] },
                  handle: { type: 'string' },
                  suggestedPin: { type: 'string' },
                },
                required: ['status', 'handle', 'suggestedPin'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { status: { type: 'string', enum: ['taken'] }, handle: { type: 'string' } },
                required: ['status', 'handle'],
                additionalProperties: false,
              },
            ],
          },
          400: refusedOrBadRequest,
        },
      },
    },
    async (request, reply) => {
      const check = checkHandle(request.body.handle);
      if (!check.ok) return refuse(reply, check.reason);
      if (players.getByKey(check.key)) return { status: 'taken', handle: check.handle };
      return { status: 'available', handle: check.handle, suggestedPin: suggestPin(secureRandom) };
    },
  );

  app.post<{ Body: HandlePinBody; Reply: PlayerAnswer | ApiError }>(
    '/api/signup',
    {
      schema: {
        body: handlePinBody,
        response: {
          201: objectSchema({ player: playerSchema }),
          400: errorSchema(['refused', 'bad-pin', 'bad-request'], true),
          409: taken,
        },
      },
    },
    async (request, reply) => {
      const check = checkHandle(request.body.handle);
      if (!check.ok) return refuse(reply, check.reason);
      if (!isValidPin(request.body.pin)) return fail(reply, 400, 'bad-pin');
      if (players.getByKey(check.key)) return fail(reply, 409, 'taken');
      const pinHash = await hashPin(request.body.pin);
      // Hashing took a moment, so ask again: another request may have taken the handle.
      const player = players.create(check.handle, check.key, pinHash);
      if (!player) return fail(reply, 409, 'taken');
      return reply.code(201).send({ player });
    },
  );

  app.post<{ Body: HandlePinBody; Reply: PlayerAnswer | ApiError }>(
    '/api/signup/claim',
    {
      schema: {
        body: handlePinBody,
        response: {
          200: objectSchema({ player: playerSchema }),
          400: refusedOrBadRequest,
          401: errorSchema(['wrong-pin']),
          404: notFound,
          429: errorSchema(['too-many-tries']),
        },
      },
      // Per client IP, online only. The per-handle limit is in the handler.
      config: online
        ? {
            rateLimit: {
              max: CLAIM_MAX_PER_IP,
              timeWindow: CLAIM_WINDOW_MS,
              keyGenerator: (request: Parameters<typeof getClientIp>[0]) => getClientIp(request, trustedProxy),
              // The error handler in app.ts turns any 429 into { error: "too-many-tries" }.
              errorResponseBuilder: (_request: unknown, context: { statusCode: number }) =>
                Object.assign(new Error('too many tries'), { statusCode: context.statusCode }),
            },
          }
        : {},
    },
    async (request, reply) => {
      const check = checkHandle(request.body.handle);
      if (!check.ok) return refuse(reply, check.reason);
      if (wrongPins?.isBlocked(check.key)) return fail(reply, 429, 'too-many-tries');
      const player = players.getByKey(check.key);
      if (!player) return fail(reply, 404, 'not-found');
      // A string that can't be a PIN is wrong without paying for a hash.
      const right = isValidPin(request.body.pin) && (await verifyPin(request.body.pin, player.pinHash));
      if (!right) {
        wrongPins?.recordFailure(check.key);
        return fail(reply, 401, 'wrong-pin');
      }
      return { player: { id: player.id, handle: player.handle } };
    },
  );

  // Host (laptop) ------------------------------------------------------------------------
  // These answer any device on the network until M3 adds host sign-in (docs/ROADMAP.md, M3).

  app.get<{ Reply: PlayersAnswer }>(
    '/api/players',
    {
      schema: {
        response: {
          200: objectSchema({ players: { type: 'array', items: playerSchema } }),
        },
      },
    },
    async () => ({ players: players.list() }),
  );

  app.post<{ Body: HandleBody; Reply: NewPlayerAnswer | ApiError }>(
    '/api/players',
    {
      schema: {
        body: handleBody,
        response: {
          201: objectSchema({ player: playerSchema, pin: pinSchema }),
          400: refusedOrBadRequest,
          // The contract lists no error for this route; a taken handle is the same 409 as a rename.
          409: taken,
        },
      },
    },
    async (request, reply) => {
      const check = checkHandle(request.body.handle);
      if (!check.ok) return refuse(reply, check.reason);
      if (players.getByKey(check.key)) return fail(reply, 409, 'taken');
      const pin = suggestPin(secureRandom);
      const pinHash = await hashPin(pin);
      const player = players.create(check.handle, check.key, pinHash);
      if (!player) return fail(reply, 409, 'taken');
      return reply.code(201).send({ player, pin });
    },
  );

  app.patch<{ Params: { id: string }; Body: HandleBody; Reply: PlayerAnswer | ApiError }>(
    '/api/players/:id',
    {
      schema: {
        params: idParams,
        body: handleBody,
        response: {
          200: objectSchema({ player: playerSchema }),
          400: refusedOrBadRequest,
          404: notFound,
          409: taken,
        },
      },
    },
    async (request, reply) => {
      const id = Number(request.params.id);
      // Unknown id first: it is the more basic mistake, and the answer doesn't depend on the handle.
      if (!players.get(id)) return fail(reply, 404, 'not-found');
      const check = checkHandle(request.body.handle);
      if (!check.ok) return refuse(reply, check.reason);
      const result = players.rename(id, check.handle, check.key);
      if (result === 'taken') return fail(reply, 409, 'taken');
      if (result === 'not-found') return fail(reply, 404, 'not-found');
      return { player: result };
    },
  );

  app.post<{ Params: { id: string }; Body: MergeBody; Reply: PlayerAnswer | ApiError }>(
    '/api/players/:id/merge',
    {
      schema: {
        params: idParams,
        body: objectSchema({ intoId: { type: 'integer', minimum: 1 } }),
        response: {
          200: objectSchema({ player: playerSchema }),
          400: badRequest,
          404: notFound,
        },
      },
    },
    async (request, reply) => {
      const id = Number(request.params.id);
      const { intoId } = request.body;
      if (id === intoId) return fail(reply, 400, 'bad-request');
      const merged = players.get(id);
      const kept = players.get(intoId);
      if (!merged || !kept) return fail(reply, 404, 'not-found');
      // Nothing else references a player yet. When matches do, move them to `kept` here first.
      players.delete(id);
      return { player: kept };
    },
  );

  app.post<{ Params: { id: string }; Reply: PinAnswer | ApiError }>(
    '/api/players/:id/reset-pin',
    {
      schema: {
        params: idParams,
        response: {
          200: objectSchema({ pin: pinSchema }),
          400: badRequest,
          404: notFound,
        },
      },
    },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!players.get(id)) return fail(reply, 404, 'not-found');
      const pin = suggestPin(secureRandom);
      const pinHash = await hashPin(pin);
      if (!players.setPinHash(id, pinHash)) return fail(reply, 404, 'not-found');
      return { pin };
    },
  );
}
