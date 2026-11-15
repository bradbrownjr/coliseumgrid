// The brackets API (docs/PLAN.md, "Brackets API"). A route loads the current event's bracket
// from the store, asks the engine to change it, and stores the new state. The engine is
// asynchronous, so every route that changes a bracket runs on the write chain, one at a time;
// reads take their snapshot in one synchronous step and need no turn. Each answer is the
// engine's `Bracket`, which carries a player only as an id and a handle (CLAUDE.md, rule 1).

import type {
  ApiError,
  BracketAnswer,
  BracketNowAnswer,
  BracketPlayerBody,
  BracketResultAnswer,
  BracketResultBody,
  BracketUndoBody,
  EventPlayersAnswer,
  NewBracketBody,
} from '@coliseumgrid/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Access } from './access.ts';
import {
  bracketSchema,
  BRACKET_FORMATS,
  errorSchema,
  fail,
  notSignedIn,
  nullableBracketSchema,
  objectSchema,
  refuse,
} from './api-schemas.ts';
import {
  bracketAnswer,
  createBracket,
  joinLate,
  recordResult,
  startTieBreak,
  undoResult,
  type BracketState,
  type EngineAnswer,
  type HandleLookup,
} from './bracket-engine.ts';
import type { BracketStore } from './bracket-store.ts';
import { iso, type Clock } from './clock.ts';
import type { Competition } from './competition.ts';
import type { EventPlayers } from './event-players.ts';
import type { Events } from './events.ts';
import type { LiveHub } from './live.ts';
import { secureRandom } from './secure-random.ts';
import type { WriteChain } from './write-chain.ts';

export interface BracketRoutesOptions {
  access: Access;
  events: Events;
  eventPlayers: EventPlayers;
  store: BracketStore;
  /** Knows the event's heats too: one competition per event. */
  competition: Competition;
  hub: LiveHub;
  chain: WriteChain;
  now: Clock;
}

// Ids are 1 and up. The schema only keeps a hostile body small; the engine checks the rules.
const idSchema = { type: 'integer', minimum: 1 } as const;

const newBracketBody = objectSchema({
  format: { type: 'string', enum: BRACKET_FORMATS },
  bestOf: { type: 'integer', enum: [1, 3, 5] },
  stations: { type: 'integer', minimum: 1, maximum: 8 },
  // No size limit here: too few and too many have their own error codes.
  playerIds: { type: 'array', items: idSchema, maxItems: 1000 },
});
// `forfeit` is optional and false when left out: the winner came and the other didn't.
const resultBody = objectSchema({ matchId: { type: 'integer', minimum: 0 }, winnerId: idSchema }, { forfeit: { type: 'boolean' } });
const undoBody = objectSchema({ resultId: idSchema });
const playerBody = objectSchema({ playerId: idSchema });

const nowAnswer = objectSchema({ bracket: bracketSchema });
const badRequest = errorSchema(['bad-request']);
const noBracket = errorSchema(['no-bracket']);
// A missing match or player, or no bracket at all.
const notFound = errorSchema(['not-found', 'no-bracket']);

export async function registerBracketRoutes(app: FastifyInstance, options: BracketRoutesOptions): Promise<void> {
  const { access, events, eventPlayers, store, competition, hub, chain, now } = options;

  /** Every current handle, read when the answer is made so a rename shows at once. */
  const handleLookup = competition.handles;

  /** The current event's bracket, or null. */
  const current = (): { eventId: number; state: BracketState } | null => {
    const eventId = events.currentId();
    const state = eventId === null ? null : store.load(eventId);
    return eventId !== null && state ? { eventId, state } : null;
  };

  /** Stores a changed bracket, tells the screens, and gives the engine's answer. */
  const commit = (eventId: number, answer: Extract<EngineAnswer, { ok: true }>) => {
    store.save(eventId, answer.state);
    // Before the screens are told, so a phone that reloads at once gets the new answer.
    competition.drop();
    hub.broadcast({ type: 'bracket' });
    return answer.bracket;
  };

  /**
   * Runs an engine change on the current bracket, stores it, and answers `{ bracket }`, or
   * 404 `no-bracket` when the event has none. `statuses` maps the engine's codes. `saved` runs
   * on the chain right after the save, for what must follow it in order.
   */
  const change = (
    reply: FastifyReply,
    work: (state: BracketState, handles: HandleLookup, noShowMinutes: number) => Promise<EngineAnswer>,
    statuses: Record<string, number>,
    saved?: () => void,
  ): Promise<FastifyReply | BracketNowAnswer> =>
    chain.run(async () => {
      const found = current();
      if (!found) return fail(reply, 404, 'no-bracket');
      const answer = await work(found.state, handleLookup(), competition.noShowMinutes());
      if (!answer.ok) return refuse(reply, answer.error, statuses);
      const bracket = commit(found.eventId, answer);
      saved?.();
      return { bracket };
    });

  app.get<{ Reply: BracketAnswer | ApiError }>(
    '/api/bracket',
    {
      onRequest: access.requireHostOrDevice,
      schema: { response: { 200: objectSchema({ bracket: nullableBracketSchema }), 401: notSignedIn } },
    },
    async () => {
      // Both reads happen before the first await, so they see one moment.
      const found = current();
      const handles = handleLookup();
      return { bracket: found ? await bracketAnswer(found.state, handles, competition.noShowMinutes()) : null };
    },
  );

  app.post<{ Body: NewBracketBody; Reply: BracketNowAnswer | ApiError }>(
    '/api/bracket',
    {
      onRequest: access.requireHost,
      schema: {
        body: newBracketBody,
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
        const handles = handleLookup();
        // A finished bracket or heats is replaced; one still being played is not.
        const eventId = events.currentId();
        if (eventId !== null && (await competition.running(eventId, handles))) return fail(reply, 409, 'bracket-running');
        const { format, bestOf, stations, playerIds } = request.body;
        const answer = await createBracket(
          { id: store.nextBracketId(), format, bestOf, stations, playerIds, createdAt: iso(now()), noShowMinutes: competition.noShowMinutes() },
          secureRandom,
          handles,
        );
        if (!answer.ok) return refuse(reply, answer.error, { 'too-few-players': 400, 'too-many-players': 400, 'bad-request': 400 });
        // The event is named now if the host hasn't yet, so the bracket has one to belong to.
        const { id, event, created } = events.ensureCurrent();
        if (created) hub.broadcast({ type: 'event', event });
        // Finished heats the event had are gone with it, so the screens that showed them reload.
        if (competition.startBracket(id, answer.state)) hub.broadcast({ type: 'heats' });
        // A player the host picked from "Not signed up" is here now, so the event lists them.
        for (const playerId of playerIds) eventPlayers.add(playerId);
        hub.broadcast({ type: 'bracket' });
        return reply.code(201).send({ bracket: answer.bracket });
      }),
  );

  app.post<{ Body: BracketResultBody; Reply: BracketResultAnswer | ApiError }>(
    '/api/bracket/results',
    {
      onRequest: access.requireHost,
      schema: {
        body: resultBody,
        response: {
          200: objectSchema({ bracket: bracketSchema, resultId: { type: 'integer' } }),
          400: badRequest,
          401: notSignedIn,
          404: notFound,
          409: errorSchema(['not-on-station']),
        },
      },
    },
    async (request, reply) => {
      const { matchId, winnerId, forfeit } = request.body;
      const answer = await change(
        reply,
        (state, handles, noShow) =>
          recordResult(state, { id: store.nextResultId(), matchId, winnerId, at: iso(now()), ...(forfeit !== undefined && { forfeit }) }, handles, noShow),
        { 'not-found': 404, 'not-on-station': 409, 'bad-request': 400 },
      );
      if (!('bracket' in answer)) return answer;
      // The result just recorded is the last one in the log.
      return { bracket: answer.bracket, resultId: answer.bracket.lastResultId as number };
    },
  );

  app.post<{ Body: BracketUndoBody; Reply: BracketNowAnswer | ApiError }>(
    '/api/bracket/undo',
    {
      onRequest: access.requireHost,
      schema: {
        body: undoBody,
        response: {
          200: nowAnswer,
          400: badRequest,
          401: notSignedIn,
          404: noBracket,
          409: errorSchema(['undo-later-first', 'nothing-to-undo']),
        },
      },
    },
    async (request, reply) =>
      change(
        reply,
        (state, handles, noShow) => undoResult(state, { resultId: request.body.resultId, at: iso(now()) }, handles, noShow),
        { 'undo-later-first': 409, 'nothing-to-undo': 409 },
      ),
  );

  app.post<{ Body: BracketPlayerBody; Reply: BracketNowAnswer | ApiError }>(
    '/api/bracket/players',
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
        (state, handles, noShow) => joinLate(state, request.body.playerId, handles, noShow),
        { 'not-found': 404, 'late-closed': 409, 'already-in': 409 },
        // A late player is here now, so the event lists them, once the bracket is saved.
        () => void eventPlayers.add(request.body.playerId),
      ),
  );

  app.post<{ Reply: BracketNowAnswer | ApiError }>(
    '/api/bracket/tie-break',
    {
      onRequest: access.requireHost,
      schema: { response: { 200: nowAnswer, 401: notSignedIn, 404: noBracket, 409: errorSchema(['no-tie']) } },
    },
    async (_request, reply) => change(reply, (state, handles, noShow) => startTieBreak(state, handles, noShow), { 'no-tie': 409 }),
  );

  app.delete(
    '/api/bracket',
    { onRequest: access.requireHost, schema: { response: { 204: { type: 'null' }, 401: notSignedIn } } },
    async (_request, reply) => {
      await chain.run(() => {
        const eventId = events.currentId();
        if (eventId !== null && store.remove(eventId)) {
          competition.drop();
          hub.broadcast({ type: 'bracket' });
        }
      });
      return reply.code(204).send();
    },
  );

  app.get<{ Reply: EventPlayersAnswer | ApiError }>(
    '/api/event/players',
    {
      onRequest: access.requireHost,
      schema: { response: { 200: objectSchema({ playerIds: { type: 'array', items: idSchema } }), 401: notSignedIn } },
    },
    async () => ({ playerIds: eventPlayers.list() }),
  );
}
