// JSON schemas and reply helpers shared by the route files. A schema lists every field of a
// body or an answer, so a field added to a handler later can't leave the server unless it is
// added here too (CLAUDE.md, rule 1).

import type { ApiError, HandleRefusal } from '@coliseumgrid/core';
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
