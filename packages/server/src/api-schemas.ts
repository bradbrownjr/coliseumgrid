// JSON schemas and reply helpers shared by the route files. A schema lists every field of a
// body or an answer, so a field added to a handler later can't leave the server unless it is
// added here too (CLAUDE.md, rule 1).

import type { ApiError, ApiErrorCode, BracketFormat, HandleRefusal, HeatKind, HeatStatus, MatchSide, MatchStatus } from '@coliseumgrid/core';
import type { FastifyReply } from 'fastify';

// Written as a Record so a reason added to core fails the type check until it is listed here.
const REFUSALS = Object.keys({
  'too-short': true,
  'too-long': true,
  'bad-characters': true,
  'not-allowed': true,
} satisfies Record<HandleRefusal, true>);

export function errorSchema(codes: string[], withReason = false) {
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

export function objectSchema(properties: Record<string, object>) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } as const;
}

// The id arrives as a string (Fastify is told not to coerce types, see app.ts), so the schema
// holds the digits check. Up to 15 digits stays a safe integer.
export const idParams = objectSchema({ id: { type: 'string', pattern: '^[1-9][0-9]{0,14}$' } });

export const notSignedIn = errorSchema(['not-signed-in']);

export function fail(reply: FastifyReply, status: number, error: Exclude<ApiError['error'], 'refused'>): FastifyReply {
  return reply.code(status).send({ error } satisfies ApiError);
}

/** Refuses with an engine's code at the status the route's table gives it. */
export function refuse(reply: FastifyReply, error: ApiErrorCode, statuses: Record<string, number>): FastifyReply {
  const status = statuses[error];
  // A code the route doesn't list can't be sent: its response schema would refuse it.
  if (status === undefined) throw new Error(`the engine refused with ${error}, which this route does not answer`);
  return fail(reply, status, error as Exclude<ApiError['error'], 'refused'>);
}

/** A player leaves the server as an id and a handle and nothing more (CLAUDE.md, rule 1). */
export const playerSchema = objectSchema({ id: { type: 'integer' }, handle: { type: 'string' } });

const nullable = (schema: object) => ({ anyOf: [{ type: 'null' }, schema] }) as const;

// Brackets (docs/PLAN.md, "Brackets API"). Each shape names every field, and the enums are
// written as Records so a word added to core fails the type check until it is listed here.
const MATCH_SIDES = Object.keys({
  main: true,
  winners: true,
  losers: true,
  final: true,
  rematch: true,
  third: true,
  'tie-break': true,
} satisfies Record<MatchSide, true>);
const MATCH_STATUSES = Object.keys({
  waiting: true,
  ready: true,
  playing: true,
  done: true,
  bye: true,
} satisfies Record<MatchStatus, true>);
export const BRACKET_FORMATS = Object.keys({ single: true, double: true, round_robin: true } satisfies Record<BracketFormat, true>);

const slotSchema = objectSchema({ player: nullable(playerSchema), bye: { type: 'boolean' } });

const matchSchema = objectSchema({
  id: { type: 'integer' },
  side: { type: 'string', enum: MATCH_SIDES },
  round: { type: 'integer' },
  number: { type: 'integer' },
  status: { type: 'string', enum: MATCH_STATUSES },
  slots: { type: 'array', items: slotSchema, minItems: 2, maxItems: 2 },
  winner: { type: ['integer', 'null'] },
  resultId: { type: ['integer', 'null'] },
});

/** A tie that has to be played off, in a bracket or in heats. */
const tieSchema = objectSchema({ place: { type: 'integer' }, players: { type: 'array', items: playerSchema }, started: { type: 'boolean' } });

export const bracketSchema = objectSchema({
  id: { type: 'integer' },
  format: { type: 'string', enum: BRACKET_FORMATS },
  bestOf: { type: 'integer', enum: [1, 3, 5] },
  finished: { type: 'boolean' },
  lateOpen: { type: 'boolean' },
  lastResultId: { type: ['integer', 'null'] },
  stations: {
    type: 'array',
    items: objectSchema({ number: { type: 'integer' }, match: nullable(matchSchema), calledAt: { type: ['string', 'null'] } }),
  },
  upNext: { type: 'array', items: matchSchema },
  matches: { type: 'array', items: matchSchema },
  standings: {
    type: 'array',
    items: objectSchema({
      place: { type: 'integer' },
      player: playerSchema,
      wins: { type: 'integer' },
      losses: { type: 'integer' },
    }),
  },
  ties: { type: 'array', items: tieSchema },
});

export const nullableBracketSchema = nullable(bracketSchema);

// Heats (docs/PLAN.md, "Heats API"). Written like the bracket shapes: every object is closed.
const HEAT_KINDS = Object.keys({ round: true, 'tie-break': true, final: true } satisfies Record<HeatKind, true>);
const HEAT_STATUSES = Object.keys({ ready: true, playing: true, done: true } satisfies Record<HeatStatus, true>);

const heatSchema = objectSchema({
  id: { type: 'integer' },
  kind: { type: 'string', enum: HEAT_KINDS },
  round: { type: 'integer' },
  number: { type: 'integer' },
  status: { type: 'string', enum: HEAT_STATUSES },
  players: { type: 'array', items: playerSchema },
  order: nullable({ type: 'array', items: playerSchema }),
  resultId: { type: ['integer', 'null'] },
});

export const heatsSchema = objectSchema({
  id: { type: 'integer' },
  races: { type: 'integer', enum: [1, 2, 3, 4] },
  rounds: { type: 'integer' },
  points: { type: 'array', items: { type: 'integer' } },
  finished: { type: 'boolean' },
  lateOpen: { type: 'boolean' },
  lastResultId: { type: ['integer', 'null'] },
  round: { type: ['integer', 'null'] },
  stations: {
    type: 'array',
    items: objectSchema({ number: { type: 'integer' }, heat: nullable(heatSchema), calledAt: { type: ['string', 'null'] } }),
  },
  upNext: { type: 'array', items: heatSchema },
  heats: { type: 'array', items: heatSchema },
  standings: {
    type: 'array',
    items: objectSchema({ place: { type: 'integer' }, player: playerSchema, points: { type: 'integer' }, heatsPlayed: { type: 'integer' } }),
  },
  finalSize: { type: 'integer' },
  ties: { type: 'array', items: tieSchema },
});

export const nullableHeatsSchema = nullable(heatsSchema);
