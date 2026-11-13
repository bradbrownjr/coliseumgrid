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
import type { Access } from './access.ts';
import { errorSchema, fail, idParams, notSignedIn, objectSchema, playerSchema } from './api-schemas.ts';
import { getClientKey } from './client-ip.ts';
import type { Mode } from './config.ts';
import type { EventPlayers } from './event-players.ts';
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
  /** Who signed up to the current event: sign-up, claim, and the host's Add player fill it. */
  eventPlayers: EventPlayers;
  /** True if the player is in a bracket of the current event (merging them away is refused). */
  inBracket: (playerId: number) => boolean;
  /** Runs a task after the bracket writes already queued, so a merge can't land inside one. */
  exclusive: <T>(task: () => T | Promise<T>) => Promise<T>;
  /** Decides who may call each route (docs/PLAN.md, "Devices and host API"). */
  access: Access;
  /** Called after the player list changes, so the host page reloads it (a "players" live message). */
  onPlayersChanged: () => void;
  mode: Mode;
  /** See getClientKey. */
  trustedProxy?: string;
}

const pinSchema = { type: 'string' } as const;

const handleBody = objectSchema({ handle: { type: 'string' } });
const handlePinBody = objectSchema({ handle: { type: 'string' }, pin: pinSchema });

const badRequest = errorSchema(['bad-request']);
const notFound = errorSchema(['not-found']);
const taken = errorSchema(['taken']);
const refusedOrBadRequest = errorSchema(['refused', 'bad-request'], true);

function refuse(reply: FastifyReply, reason: HandleRefusal): FastifyReply {
  return reply.code(400).send({ error: 'refused', reason } satisfies ApiError);
}

export async function registerPlayerRoutes(app: FastifyInstance, options: PlayerRoutesOptions): Promise<void> {
  const { players, eventPlayers, inBracket, exclusive, access, onPlayersChanged, trustedProxy } = options;
  const online = options.mode === 'online';

  // Claim attempts per handle, online only. Counted here rather than by @fastify/rate-limit
  // because a right PIN should cost nothing: an attempt is reserved before the PIN is checked
  // and cleared when it is right. Reserving first matters because the check awaits a hash;
  // counting after it would let every request that arrives meanwhile through.
  const wrongPins = online ? new FailureLimiter(CLAIM_MAX_WRONG_PER_HANDLE, CLAIM_WINDOW_MS) : undefined;

  /** Clears the count for a stored handle (its key is derived the same way as on sign-up). */
  const forget = (handle: string | undefined): void => {
    if (handle === undefined) return;
    const check = checkHandle(handle);
    if (check.ok) wrongPins?.clear(check.key);
  };

  if (online) await app.register(rateLimit, { global: false });

  // Sign-up (tablet) ---------------------------------------------------------------------

  app.post<{ Body: HandleBody; Reply: SignupCheckAnswer | ApiError }>(
    '/api/signup/check',
    {
      onRequest: access.requireSignup,
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
          401: notSignedIn,
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
      onRequest: access.requireSignup,
      schema: {
        body: handlePinBody,
        response: {
          201: objectSchema({ player: playerSchema }),
          400: errorSchema(['refused', 'bad-pin', 'bad-request'], true),
          401: notSignedIn,
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
      eventPlayers.add(player.id);
      onPlayersChanged();
      return reply.code(201).send({ player });
    },
  );

  app.post<{ Body: HandlePinBody; Reply: PlayerAnswer | ApiError }>(
    '/api/signup/claim',
    {
      onRequest: access.requireSignup,
      schema: {
        body: handlePinBody,
        response: {
          200: objectSchema({ player: playerSchema }),
          400: refusedOrBadRequest,
          401: errorSchema(['wrong-pin', 'not-signed-in']),
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
              keyGenerator: (request: Parameters<typeof getClientKey>[0]) => getClientKey(request, trustedProxy),
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
      const player = players.getByKey(check.key);
      if (!player) return fail(reply, 404, 'not-found');
      // No await between here and the reservation, so concurrent claims each take their own slot.
      if (wrongPins && !wrongPins.tryAttempt(check.key)) return fail(reply, 429, 'too-many-tries');
      // A string that can't be a PIN is wrong without paying for a hash.
      const right = isValidPin(request.body.pin) && (await verifyPin(request.body.pin, player.pinHash));
      if (!right) return fail(reply, 401, 'wrong-pin');
      // Earlier mistypes don't carry over to the player's next sign-in.
      wrongPins?.clear(check.key);
      // A returning player counts as here today. The host's list of players reloads only when
      // that changed something.
      if (eventPlayers.add(player.id)) onPlayersChanged();
      return { player: { id: player.id, handle: player.handle } };
    },
  );

  // Host (laptop) ------------------------------------------------------------------------
  // These need a host session (offline, the laptop itself counts as one).

  app.get<{ Reply: PlayersAnswer }>(
    '/api/players',
    {
      onRequest: access.requireHost,
      schema: {
        response: {
          200: objectSchema({ players: { type: 'array', items: playerSchema } }),
          401: notSignedIn,
        },
      },
    },
    async () => ({ players: players.list() }),
  );

  app.post<{ Body: HandleBody; Reply: NewPlayerAnswer | ApiError }>(
    '/api/players',
    {
      onRequest: access.requireHost,
      schema: {
        body: handleBody,
        response: {
          201: objectSchema({ player: playerSchema, pin: pinSchema }),
          400: refusedOrBadRequest,
          401: notSignedIn,
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
      eventPlayers.add(player.id);
      onPlayersChanged();
      return reply.code(201).send({ player, pin });
    },
  );

  app.patch<{ Params: { id: string }; Body: HandleBody; Reply: PlayerAnswer | ApiError }>(
    '/api/players/:id',
    {
      onRequest: access.requireHost,
      schema: {
        params: idParams,
        body: handleBody,
        response: {
          200: objectSchema({ player: playerSchema }),
          400: refusedOrBadRequest,
          401: notSignedIn,
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
      const before = players.get(id);
      const result = players.rename(id, check.handle, check.key);
      if (result === 'taken') return fail(reply, 409, 'taken');
      if (result === 'not-found') return fail(reply, 404, 'not-found');
      // A count belongs to a handle meaning one player. Clear the old key so the next player
      // to take it starts fresh, and the new key so the renamed player isn't locked by a
      // stranger's earlier tries.
      forget(before?.handle);
      wrongPins?.clear(check.key);
      onPlayersChanged();
      return { player: result };
    },
  );

  app.post<{ Params: { id: string }; Body: MergeBody; Reply: PlayerAnswer | ApiError }>(
    '/api/players/:id/merge',
    {
      onRequest: access.requireHost,
      schema: {
        params: idParams,
        body: objectSchema({ intoId: { type: 'integer', minimum: 1 } }),
        response: {
          200: objectSchema({ player: playerSchema }),
          400: badRequest,
          401: notSignedIn,
          404: notFound,
          409: errorSchema(['in-bracket']),
        },
      },
    },
    async (request, reply) => {
      const id = Number(request.params.id);
      const { intoId } = request.body;
      if (id === intoId) return fail(reply, 400, 'bad-request');
      // Queued behind any bracket write, so the player can't join a bracket between the check
      // and the delete.
      return exclusive(() => {
        const merged = players.get(id);
        const kept = players.get(intoId);
        if (!merged || !kept) return fail(reply, 404, 'not-found');
        // A bracket holds its players by id, running or finished, and its answer needs every
        // handle. Deleting the bracket frees them.
        if (inBracket(id)) return fail(reply, 409, 'in-bracket');
        // Attendance follows the player kept; nothing else references a player yet.
        eventPlayers.move(id, intoId);
        players.delete(id);
        // The merged handle no longer means this player, so its count goes with it.
        forget(merged.handle);
        onPlayersChanged();
        return { player: kept };
      });
    },
  );

  app.post<{ Params: { id: string }; Reply: PinAnswer | ApiError }>(
    '/api/players/:id/reset-pin',
    {
      onRequest: access.requireHost,
      schema: {
        params: idParams,
        response: {
          200: objectSchema({ pin: pinSchema }),
          400: badRequest,
          401: notSignedIn,
          404: notFound,
        },
      },
    },
    async (request, reply) => {
      const id = Number(request.params.id);
      const player = players.get(id);
      if (!player) return fail(reply, 404, 'not-found');
      const pin = suggestPin(secureRandom);
      const pinHash = await hashPin(pin);
      if (!players.setPinHash(id, pinHash)) return fail(reply, 404, 'not-found');
      // A locked player is told to ask the host; the new PIN has to work right away.
      forget(player.handle);
      // No onPlayersChanged: the list shows handles only, and a PIN reset doesn't change it.
      return { pin };
    },
  );
}
