// The heats API (docs/PLAN.md, "Heats API"). A route loads the current event's heats from the
// store, asks the engine to change them, and stores the new state. Every route that changes
// heats runs on the write chain, the one every bracket write uses, so two taps can't
// interleave and a bracket and heats can't both be started for one event; reads take their
// snapshot in one synchronous step and need no turn. Each answer is the engine's `Heats`,
// which carries a player only as an id and a handle (CLAUDE.md, rule 1).

import type {
  ApiError,
  HeatArrivedBody,
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
  setHeatArrived,
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
// A heat holds 2 to 4 players, so a longer order or list is never right. `missing` is optional
// and empty when left out; `isHeatResult` checks that the two lists are the heat's players.
const resultBody = objectSchema(
  { heatId: { type: 'integer', minimum: 0 }, order: { type: 'array', items: idSchema, maxItems: 4 } },
  { missing: { type: 'array', items: idSchema, maxItems: 4 } },
);
const undoBody = objectSchema({ resultId: idSchema });
const playerBody = objectSchema({ playerId: idSchema });
const arrivedBody = objectSchema({ heatId: { type: 'integer', minimum: 0 }, arrived: { type: 'boolean' } });

// Every answer that carries the heats carries the server's clock too, read when the answer is
// sent (see bracket-routes.ts), so a screen can time `calledAt` against it.
const timeSchema = { type: 'string' } as const;
const nowAnswer = objectSchema({ heats: heatsSchema, now: timeSchema });
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
    work: (state: HeatState, handles: HandleLookup, noShowMinutes: number) => HeatEngineAnswer,
    statuses: Record<string, number>,
    saved?: () => void,
  ): Promise<FastifyReply | HeatsNowAnswer> =>
    chain.run(() => {
      const found = current();
      if (!found) return fail(reply, 404, 'no-heats');
      const answer = work(found.state, competition.handles(), competition.noShowMinutes());
      if (!answer.ok) return refuse(reply, answer.error, statuses);
      store.save(found.eventId, answer.state);
      // Before the screens are told, so a phone that reloads at once gets the new answer.
      competition.drop();
      saved?.();
      hub.broadcast({ type: 'heats' });
      return { heats: answer.heats, now: iso(now()) };
    });

  app.get<{ Reply: HeatsAnswer | ApiError }>(
    '/api/heats',
    {
      onRequest: access.requireHostOrDevice,
      schema: { response: { 200: objectSchema({ heats: nullableHeatsSchema, now: timeSchema }), 401: notSignedIn } },
    },
    async () => {
      // Both reads happen in one synchronous step, so they see one moment.
      const found = current();
      return { heats: found ? heatsAnswer(found.state, competition.handles(), competition.noShowMinutes()) : null, now: iso(now()) };
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
          { id: store.nextRunId(), stations, races, rounds, points, playerIds, createdAt: iso(now()), noShowMinutes: competition.noShowMinutes() },
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
        return reply.code(201).send({ heats: answer.heats, now: iso(now()) });
      }),
  );

  app.post<{ Body: HeatResultBody; Reply: HeatResultAnswer | ApiError }>(
    '/api/heats/results',
    {
      onRequest: access.requireHost,
      schema: {
        body: resultBody,
        response: {
          200: objectSchema({ heats: heatsSchema, resultId: { type: 'integer' }, now: timeSchema }),
          400: badRequest,
          401: notSignedIn,
          404: notFound,
          409: errorSchema(['not-on-station']),
        },
      },
    },
    async (request, reply) => {
      const { heatId, order, missing } = request.body;
      const answer = await change(
        reply,
        (state, handles, noShow) =>
          recordHeatResult(state, { id: store.nextResultId(), heatId, order, ...(missing !== undefined && { missing }), at: iso(now()) }, handles, noShow),
        { 'not-found': 404, 'not-on-station': 409, 'bad-request': 400 },
      );
      // `change` sent a refusal itself. The reply is thenable, so awaiting it gives `undefined`
      // (Fastify's `Reply.prototype.then` fulfils with no value); hand back `reply` instead.
      if (reply.sent || !('heats' in answer)) return reply;
      // The result just recorded is the last one in the log.
      return { heats: answer.heats, resultId: answer.heats.lastResultId as number, now: answer.now };
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
      change(reply, (state, handles, noShow) => undoHeatResult(state, { resultId: request.body.resultId, at: iso(now()) }, handles, noShow), {
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
        (state, handles, noShow) => joinHeatsLate(state, request.body.playerId, handles, noShow),
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
    // The stations the tie-break fills are called now, not at the time of the last result.
    async (_request, reply) => change(reply, (state, handles, noShow) => startHeatTieBreak(state, handles, noShow, iso(now())), { 'no-tie': 409 }),
  );

  // **They're here** for a group (docs/PLAN.md, "Waiting for a missing player"): host only, and
  // stored against the station's current call.
  app.post<{ Body: HeatArrivedBody; Reply: HeatsNowAnswer | ApiError }>(
    '/api/heats/arrived',
    {
      onRequest: access.requireHost,
      schema: {
        body: arrivedBody,
        response: { 200: nowAnswer, 400: badRequest, 401: notSignedIn, 404: notFound, 409: errorSchema(['not-on-station']) },
      },
    },
    async (request, reply) =>
      change(reply, (state, handles, noShow) => setHeatArrived(state, request.body, handles, noShow), { 'not-found': 404, 'not-on-station': 409 }),
  );

  app.delete(
    '/api/heats',
    { onRequest: access.requireHost, schema: { response: { 204: { type: 'null' }, 401: notSignedIn } } },
    async (_request, reply) => {
      await chain.run(() => {
        const eventId = events.currentId();
        if (eventId !== null && store.remove(eventId)) {
          competition.drop();
          hub.broadcast({ type: 'heats' });
        }
      });
      return reply.code(204).send();
    },
  );
}
