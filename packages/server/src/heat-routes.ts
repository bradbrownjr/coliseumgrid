// The heats API (docs/PLAN.md, "Heats API"). A route loads the current event's heats from the
// store, asks the engine to change them, and stores the new state. Every route that changes
// heats runs on the write chain, the one every bracket write uses, so two taps can't
// interleave and a bracket and heats can't both be started for one event; reads take their
// snapshot in one synchronous step and need no turn. Each answer is the engine's `Heats`,
// which carries a player only as an id and a handle (CLAUDE.md, rule 1).

import type {
  ApiError,
  HeatPlayerBody,
  HeatResultAnswer,
  HeatResultBody,
  HeatsAnswer,
  HeatsNowAnswer,
  HeatUndoBody,
  NewHeatsBody,
} from '@coliseumgrid/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Access } from './access.ts';
import { errorSchema, fail, heatsSchema, notSignedIn, nullableHeatsSchema, objectSchema, refuse } from './api-schemas.ts';
import type { HandleLookup } from './bracket-engine.ts';
import { iso, type Clock } from './clock.ts';
import type { Competition } from './competition.ts';
import type { EventPlayers } from './event-players.ts';
import type { Events } from './events.ts';
import {
  createHeats,
  heatsAnswer,
  joinHeatsLate,
  recordHeatResult,
  startHeatTieBreak,
  undoHeatResult,
  type HeatEngineAnswer,
  type HeatState,
} from './heat-engine.ts';
import type { HeatStore } from './heat-store.ts';
import type { LiveHub } from './live.ts';
import { secureRandom } from './secure-random.ts';
import type { WriteChain } from './write-chain.ts';

export interface HeatRoutesOptions {
  access: Access;
  events: Events;
  eventPlayers: EventPlayers;
  store: HeatStore;
  /** Knows the event's bracket too: one competition per event. */
  competition: Competition;
  hub: LiveHub;
  chain: WriteChain;
  now: Clock;
}

// Ids are 1 and up. The schema only keeps a hostile body small; the engine checks the rules.
const idSchema = { type: 'integer', minimum: 1 } as const;

const newHeatsBody = objectSchema({
  stations: { type: 'integer', minimum: 1, maximum: 8 },
  races: { type: 'integer', enum: [1, 2, 3, 4] },
  // 0 is for the engine to refuse (or to store, with 2 to 4 players); its own codes say which.
  rounds: { type: 'integer', minimum: 0, maximum: 3 },
  // `isPointsTable` checks the numbers; the schema only fixes the shape.
  points: { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4 },
  // No size limit here: too few and too many have their own error codes.
  playerIds: { type: 'array', items: idSchema, maxItems: 1000 },
});
// A heat holds 2 to 4 players, so a longer order is never right.
const resultBody = objectSchema({ heatId: { type: 'integer', minimum: 0 }, order: { type: 'array', items: idSchema, maxItems: 4 } });
const undoBody = objectSchema({ resultId: idSchema });
const playerBody = objectSchema({ playerId: idSchema });

const nowAnswer = objectSchema({ heats: heatsSchema });
const badRequest = errorSchema(['bad-request']);
const noHeats = errorSchema(['no-heats']);
// A missing heat or player, or no heats at all.
const notFound = errorSchema(['not-found', 'no-heats']);

export async function registerHeatRoutes(app: FastifyInstance, options: HeatRoutesOptions): Promise<void> {
  const { access, events, eventPlayers, store, competition, hub, chain, now } = options;

  /** The current event's heats, or null. */
  const current = (): { eventId: number; state: HeatState } | null => {
    const eventId = events.currentId();
    const state = eventId === null ? null : store.load(eventId);
    return eventId !== null && state ? { eventId, state } : null;
  };

  /**
   * Runs an engine change on the current heats, stores it, and answers `{ heats }`, or 404
   * `no-heats` when the event has none. `statuses` maps the engine's codes. `saved` runs on
   * the chain right after the save, for what must follow it in order.
   */
  const change = (
    reply: FastifyReply,
    work: (state: HeatState, handles: HandleLookup) => HeatEngineAnswer,
    statuses: Record<string, number>,
    saved?: () => void,
  ): Promise<FastifyReply | HeatsNowAnswer> =>
    chain.run(() => {
      const found = current();
      if (!found) return fail(reply, 404, 'no-heats');
      const answer = work(found.state, competition.handles());
      if (!answer.ok) return refuse(reply, answer.error, statuses);
      store.save(found.eventId, answer.state);
      saved?.();
      hub.broadcast({ type: 'heats' });
      return { heats: answer.heats };
    });

  app.get<{ Reply: HeatsAnswer | ApiError }>(
    '/api/heats',
    {
      onRequest: access.requireHostOrDevice,
      schema: { response: { 200: objectSchema({ heats: nullableHeatsSchema }), 401: notSignedIn } },
    },
    async () => {
      // Both reads happen in one synchronous step, so they see one moment.
      const found = current();
      return { heats: found ? heatsAnswer(found.state, competition.handles()) : null };
    },
  );

  app.post<{ Body: NewHeatsBody; Reply: HeatsNowAnswer | ApiError }>(
    '/api/heats',
    {
      onRequest: access.requireHost,
      schema: {
        body: newHeatsBody,
        response: {
          201: nowAnswer,
          400: errorSchema(['too-few-players', 'too-many-players', 'bad-request']),
          401: notSignedIn,
          409: errorSchema(['bracket-running']),
        },
      },
    },
    async (request, reply) =>
      chain.run(async () => {
        const handles = competition.handles();
        // A finished bracket or heats is replaced; one still being played is not.
        const oldEventId = events.currentId();
        if (oldEventId !== null && (await competition.running(oldEventId, handles))) return fail(reply, 409, 'bracket-running');
        const { stations, races, rounds, points, playerIds } = request.body;
        const answer = createHeats(
          { id: store.nextRunId(), stations, races, rounds, points, playerIds, createdAt: iso(now()) },
          secureRandom,
          handles,
        );
        if (!answer.ok) return refuse(reply, answer.error, { 'too-few-players': 400, 'too-many-players': 400, 'bad-request': 400 });
        // The event is named now if the host hasn't yet, so the heats have one to belong to.
        const { id, event, created } = events.ensureCurrent();
        if (created) hub.broadcast({ type: 'event', event });
        // A finished bracket the event had is gone with it, so the screens that showed it reload.
        if (competition.startHeats(id, answer.state)) hub.broadcast({ type: 'bracket' });
        // A player the host picked from "Not signed up" is here now, so the event lists them.
        for (const playerId of playerIds) eventPlayers.add(playerId);
        hub.broadcast({ type: 'heats' });
        return reply.code(201).send({ heats: answer.heats });
      }),
  );

  app.post<{ Body: HeatResultBody; Reply: HeatResultAnswer | ApiError }>(
    '/api/heats/results',
    {
      onRequest: access.requireHost,
      schema: {
        body: resultBody,
        response: {
          200: objectSchema({ heats: heatsSchema, resultId: { type: 'integer' } }),
          400: badRequest,
          401: notSignedIn,
          404: notFound,
          409: errorSchema(['not-on-station']),
        },
      },
    },
    async (request, reply) => {
      const { heatId, order } = request.body;
      const answer = await change(
        reply,
        (state, handles) => recordHeatResult(state, { id: store.nextResultId(), heatId, order, at: iso(now()) }, handles),
        { 'not-found': 404, 'not-on-station': 409, 'bad-request': 400 },
      );
      if (!('heats' in answer)) return answer;
      // The result just recorded is the last one in the log.
      return { heats: answer.heats, resultId: answer.heats.lastResultId as number };
    },
  );

  app.post<{ Body: HeatUndoBody; Reply: HeatsNowAnswer | ApiError }>(
    '/api/heats/undo',
    {
      onRequest: access.requireHost,
      schema: {
        body: undoBody,
        response: {
          200: nowAnswer,
          400: badRequest,
          401: notSignedIn,
          404: noHeats,
          409: errorSchema(['undo-later-first', 'nothing-to-undo']),
        },
      },
    },
    async (request, reply) =>
      change(reply, (state, handles) => undoHeatResult(state, { resultId: request.body.resultId, at: iso(now()) }, handles), {
        'undo-later-first': 409,
        'nothing-to-undo': 409,
      }),
  );

  app.post<{ Body: HeatPlayerBody; Reply: HeatsNowAnswer | ApiError }>(
    '/api/heats/players',
    {
      onRequest: access.requireHost,
      schema: {
        body: playerBody,
        response: {
          200: nowAnswer,
          400: badRequest,
          401: notSignedIn,
          404: notFound,
          409: errorSchema(['late-closed', 'already-in']),
        },
      },
    },
    async (request, reply) =>
      change(
        reply,
        (state, handles) => joinHeatsLate(state, request.body.playerId, handles),
        { 'not-found': 404, 'late-closed': 409, 'already-in': 409 },
        // A late player is here now, so the event lists them, once the heats are saved.
        () => void eventPlayers.add(request.body.playerId),
      ),
  );

  app.post<{ Reply: HeatsNowAnswer | ApiError }>(
    '/api/heats/tie-break',
    {
      onRequest: access.requireHost,
      schema: { response: { 200: nowAnswer, 401: notSignedIn, 404: noHeats, 409: errorSchema(['no-tie']) } },
    },
    async (_request, reply) => change(reply, (state, handles) => startHeatTieBreak(state, handles), { 'no-tie': 409 }),
  );

  app.delete(
    '/api/heats',
    { onRequest: access.requireHost, schema: { response: { 204: { type: 'null' }, 401: notSignedIn } } },
    async (_request, reply) => {
      await chain.run(() => {
        const eventId = events.currentId();
        if (eventId !== null && store.remove(eventId)) hub.broadcast({ type: 'heats' });
      });
      return reply.code(204).send();
    },
  );
}
