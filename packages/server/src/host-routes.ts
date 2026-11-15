// Host sign-in, pairing, devices, the event, and the live connection (docs/PLAN.md, "Devices
// and host API"). Bodies are JSON, every answer lists its fields, errors are { error: code }.

import {
  EVENT_NAME_MAX,
  NO_SHOW_DEFAULT,
  isEventPlan,
  parseJoinCode,
  type ApiError,
  type DeviceAnswer,
  type DevicesAnswer,
  type EventAnswer,
  type EventBody,
  type HostSessionAnswer,
  type JoinBody,
  type NewEventAnswer,
  type PairingCodeAnswer,
  type PairingCodeBody,
  type PasswordBody,
  type PlanAnswer,
  type PlanBody,
  type PlanNowAnswer,
} from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { rejectForeignOrigin, type Access } from './access.ts';
import {
  errorSchema,
  eventInfoSchema,
  fail,
  idParams,
  notSignedIn,
  nullableEventSchema,
  objectSchema,
  planSchema,
} from './api-schemas.ts';
import { getClientKey } from './client-ip.ts';
import type { Clock } from './clock.ts';
import type { Competition } from './competition.ts';
import { HOST_PASSWORD_MAX, HOST_PASSWORD_MIN } from './config.ts';
import type { Devices } from './devices.ts';
import { cleanEventName, cleanGameName, type Events } from './events.ts';
import type { LiveHub } from './live.ts';
import type { TagQueue } from './tag-queue.ts';
import { ALL_CALLERS, FailureLimiter, GUESS_WINDOW_MS, SIGN_IN_MAX_WRONG_PER_IP, type JoinLimits } from './rate-limit.ts';
import { secureRandom } from './secure-random.ts';
import { hashToken, newToken } from './tokens.ts';
import type { WriteChain } from './write-chain.ts';

export interface HostRoutesOptions {
  access: Access;
  devices: Devices;
  events: Events;
  /** Asked whether a bracket or groups are running before a new event is made (`POST /api/events`). */
  competition: Competition;
  hub: LiveHub;
  /** The one chain every bracket and heats write runs on, so a new event can't interleave with a start. */
  chain: WriteChain;
  now: Clock;
  /** Called after the event changes, so the kept phone answer is dropped. */
  onEventChanged: () => void;
  /** The print queue, which a new event empties. */
  tags: TagQueue;
  /** Called after the queue changes, so host screens reload it. */
  onTagsChanged: () => void;
  /** The wrong-code limits, shared with the follow codes. */
  joinLimits: JoinLimits;
  /** See getClientKey. */
  trustedProxy?: string;
}

const deviceSchema = objectSchema({
  id: { type: 'integer' },
  role: { type: 'string', enum: ['display', 'signup'] },
  label: { type: 'string' },
  lastSeen: { type: 'string' },
});


// The body schemas only keep a huge body from reaching a hash; the rules are checked in code.
const passwordBody = objectSchema({ password: { type: 'string', maxLength: HOST_PASSWORD_MAX } });
const setupBody = objectSchema({
  password: { type: 'string', minLength: HOST_PASSWORD_MIN, maxLength: HOST_PASSWORD_MAX },
});
const codeBody = objectSchema({ code: { type: 'string', maxLength: 64 } });
const roleBody = objectSchema({ role: { type: 'string', enum: ['display', 'signup'] } });
// The lengths only keep a huge body small; `cleanEventName` and `cleanGameName` check the rest.
// `game` is optional: on PUT, leaving it out keeps the stored game and '' clears it.
const eventBody = objectSchema({ name: { type: 'string', maxLength: 4 * EVENT_NAME_MAX } }, { game: { type: 'string', maxLength: 4 * EVENT_NAME_MAX } });
const planBody = objectSchema({ plan: planSchema });

const badRequest = errorSchema(['bad-request']);
const tooManyTries = errorSchema(['too-many-tries']);

export async function registerHostRoutes(app: FastifyInstance, options: HostRoutesOptions): Promise<void> {
  const { access, devices, events, competition, hub, chain, now, joinLimits, onEventChanged, tags, onTagsChanged, trustedProxy } = options;

  // Wrong passwords and wrong codes per client IP, in both modes (CLAUDE.md, rule 7). An
  // attempt is reserved before the slow check and cleared when it is right, so requests
  // that arrive while a hash is running can't all slip past the limit.
  const signInTries = new FailureLimiter(SIGN_IN_MAX_WRONG_PER_IP, GUESS_WINDOW_MS, now);
  const joinTries = joinLimits.perIp;
  // One count for every caller, for a guesser who has many addresses.
  const joinTriesAll = joinLimits.all;

  // Host sign-in ------------------------------------------------------------------------

  app.get<{ Reply: HostSessionAnswer }>(
    '/api/host/session',
    {
      schema: {
        response: {
          200: objectSchema({
            signedIn: { type: 'boolean' },
            passwordSet: { type: 'boolean' },
            canSetUp: { type: 'boolean' },
          }),
        },
      },
    },
    async (request) => ({
      signedIn: access.identify(request).host,
      passwordSet: access.passwordSet(),
      canSetUp: access.canSetUp(request),
    }),
  );

  app.post<{ Body: PasswordBody }>(
    '/api/host/setup',
    {
      schema: { body: setupBody, response: { 400: badRequest, 403: errorSchema(['forbidden']) } },
      // Checked first: a caller who may not set up gets 403 whatever the body is.
      preValidation: async (request, reply) => (access.canSetUp(request) ? undefined : fail(reply, 403, 'forbidden')),
    },
    async (request, reply) => {
      // Hashing takes a moment; setPassword asks again, and the first writer wins.
      if (!(await access.setPassword(request.body.password))) return fail(reply, 403, 'forbidden');
      access.startHostSession(request, reply);
      return reply.code(204).send();
    },
  );

  app.post<{ Body: PasswordBody }>(
    '/api/host/sign-in',
    {
      schema: {
        body: passwordBody,
        response: { 400: badRequest, 401: errorSchema(['wrong-password']), 429: tooManyTries },
      },
    },
    async (request, reply) => {
      const ip = getClientKey(request, trustedProxy);
      // No await between here and the reservation, so concurrent guesses each take their own slot.
      if (!signInTries.tryAttempt(ip)) return fail(reply, 429, 'too-many-tries');
      if (!(await access.verifyPassword(request.body.password))) return fail(reply, 401, 'wrong-password');
      signInTries.clear(ip);
      access.startHostSession(request, reply);
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/host/sign-out',
    { onRequest: access.requireHost, schema: { response: { 204: { type: 'null' }, 401: notSignedIn } } },
    async (request, reply) => {
      const ended = access.endHostSession(request, reply);
      if (ended !== undefined) hub.endSession(ended);
      return reply.code(204).send();
    },
  );

  // Pairing and devices -----------------------------------------------------------------

  app.post<{ Body: PairingCodeBody; Reply: PairingCodeAnswer | ApiError }>(
    '/api/pairing/codes',
    {
      onRequest: access.requireHost,
      schema: {
        body: roleBody,
        response: {
          201: objectSchema({
            code: { type: 'string' },
            role: { type: 'string', enum: ['display', 'signup'] },
            expiresAt: { type: 'string' },
          }),
          400: badRequest,
          401: notSignedIn,
        },
      },
    },
    async (request, reply) => reply.code(201).send(devices.createCode(request.body.role, secureRandom)),
  );

  app.post<{ Body: JoinBody; Reply: DeviceAnswer | ApiError }>(
    '/api/devices/join',
    {
      schema: {
        body: codeBody,
        response: { 201: objectSchema({ device: deviceSchema }), 400: badRequest, 404: errorSchema(['wrong-code']), 429: tooManyTries },
      },
    },
    async (request, reply) => {
      const ip = getClientKey(request, trustedProxy);
      // Both are reserved up front, and everything up to the answer is synchronous.
      if (!joinTries.tryAttempt(ip) || !joinTriesAll.tryAttempt(ALL_CALLERS)) return fail(reply, 429, 'too-many-tries');
      // A code that can't be read counts as a wrong guess, like one that isn't live.
      const code = parseJoinCode(request.body.code);
      const token = newToken();
      const device = code === null ? null : devices.pair(code, hashToken(token));
      if (!device) return fail(reply, 404, 'wrong-code');
      // Only wrong codes count, so a right one gives back its slot on both counts. Clearing the
      // address's count would also forget its wrong follow codes, which share it.
      joinTries.refund(ip);
      joinTriesAll.refund(ALL_CALLERS);
      // A browser that was already paired and pairs again replaces its old device, so the
      // host's list doesn't keep a screen that no longer exists.
      const old = access.identify(request).device;
      if (old && devices.remove(old.id)) hub.unpair(old.id);
      access.setDeviceCookie(request, reply, token);
      return reply.code(201).send({ device });
    },
  );

  app.get<{ Reply: DeviceAnswer | ApiError }>(
    '/api/devices/me',
    { schema: { response: { 200: objectSchema({ device: deviceSchema }), 401: errorSchema(['not-paired']) } } },
    async (request, reply) => {
      const { device } = access.identify(request);
      return device ? { device } : fail(reply, 401, 'not-paired');
    },
  );

  app.get<{ Reply: DevicesAnswer | ApiError }>(
    '/api/devices',
    {
      onRequest: access.requireHost,
      schema: { response: { 200: objectSchema({ devices: { type: 'array', items: deviceSchema } }), 401: notSignedIn } },
    },
    async () => ({ devices: devices.list() }),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/devices/:id',
    {
      onRequest: access.requireHost,
      schema: { params: idParams, response: { 400: badRequest, 401: notSignedIn, 404: errorSchema(['not-found']) } },
    },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!devices.remove(id)) return fail(reply, 404, 'not-found');
      // The row is gone, so the token already fails; this tells the screen and closes it.
      hub.unpair(id);
      return reply.code(204).send();
    },
  );

  // The event ---------------------------------------------------------------------------

  app.get<{ Reply: EventAnswer | ApiError }>(
    '/api/event',
    {
      onRequest: access.requireViewer,
      schema: { response: { 200: objectSchema({ event: nullableEventSchema }), 401: notSignedIn } },
    },
    async () => ({ event: events.current() }),
  );

  app.put<{ Body: EventBody; Reply: EventAnswer | ApiError }>(
    '/api/event',
    {
      onRequest: access.requireHost,
      schema: { body: eventBody, response: { 200: objectSchema({ event: nullableEventSchema }), 400: badRequest, 401: notSignedIn } },
    },
    async (request, reply) => {
      const name = cleanEventName(request.body.name);
      const game = request.body.game === undefined ? undefined : cleanGameName(request.body.game);
      if (name === null || game === null) return fail(reply, 400, 'bad-request');
      const event = events.setName(name, game);
      onEventChanged();
      hub.broadcast({ type: 'event', event });
      return { event };
    },
  );

  // A new event (docs/PLAN.md, "The setup wizard", "A new event"). It runs on the write chain,
  // so the check for a running competition and the insert can't interleave with a start.
  // The old event keeps its bracket or groups; the new one has no players until they sign up.
  app.post<{ Body: EventBody; Reply: NewEventAnswer | ApiError }>(
    '/api/events',
    {
      onRequest: access.requireHost,
      schema: {
        body: eventBody,
        response: { 201: objectSchema({ event: eventInfoSchema }), 400: badRequest, 401: notSignedIn, 409: errorSchema(['bracket-running']) },
      },
    },
    async (request, reply) => {
      const name = cleanEventName(request.body.name);
      const game = request.body.game === undefined ? undefined : cleanGameName(request.body.game);
      if (name === null || game === null) return fail(reply, 400, 'bad-request');
      return chain.run(async () => {
        // A finished competition doesn't block a new event; one still being played does.
        const oldId = events.currentId();
        if (oldId !== null && (await competition.running(oldId, competition.handles()))) return fail(reply, 409, 'bracket-running');
        // The new event keeps the graphic (events.create) and starts with an empty print queue,
        // as it starts with no players (docs/PLAN.md, "The print queue").
        const event = events.create(name, game);
        const tagsCleared = tags.clear() > 0;
        // Before the screens are told, so a phone that reloads at once gets the new answer.
        onEventChanged();
        hub.broadcast({ type: 'event', event });
        hub.broadcast({ type: 'players' });
        hub.broadcast({ type: 'bracket' });
        hub.broadcast({ type: 'heats' });
        // The new event starts with the plan the old one had, so a wizard open elsewhere reads it again.
        hub.broadcast({ type: 'plan' });
        if (tagsCleared) onTagsChanged();
        return reply.code(201).send({ event });
      });
    },
  );

  // The plan (docs/PLAN.md, "The setup wizard", "Storage and routes"). Host only: a phone, a
  // Sign-up tablet, and a Display have no use for it. `isEventPlan` is the check (CLAUDE.md,
  // rule 2); the schema keeps the body closed.
  app.get<{ Reply: PlanAnswer | ApiError }>(
    '/api/event/plan',
    {
      onRequest: access.requireHost,
      schema: { response: { 200: objectSchema({ plan: { anyOf: [{ type: 'null' }, planSchema] } }), 401: notSignedIn } },
    },
    async () => ({ plan: events.plan() }),
  );

  app.put<{ Body: PlanBody; Reply: PlanNowAnswer | ApiError }>(
    '/api/event/plan',
    {
      onRequest: access.requireHost,
      schema: { body: planBody, response: { 200: objectSchema({ plan: planSchema }), 400: badRequest, 401: notSignedIn } },
    },
    async (request, reply) => {
      const { plan } = request.body;
      if (!isEventPlan(plan)) return fail(reply, 400, 'bad-request');
      const before = events.plan()?.noShowMinutes ?? NO_SHOW_DEFAULT;
      const { created, event } = events.setPlan(plan);
      // The bracket and groups answers carry `noShowMinutes` from the plan.
      onEventChanged();
      if (created) hub.broadcast({ type: 'event', event });
      // No payload, like the other messages: a host window with the wizard open reads the plan again.
      hub.broadcast({ type: 'plan' });
      if (plan.noShowMinutes !== before) {
        hub.broadcast({ type: 'bracket' });
        hub.broadcast({ type: 'heats' });
      }
      return { plan };
    },
  );

  // Live updates ------------------------------------------------------------------------

  app.get(
    '/api/live',
    // A browser sends Origin on every WebSocket handshake, and cookies ride along from any page
    // of the same site, so the handshake is checked like a state-changing request (app.ts).
    { websocket: true, onRequest: [rejectForeignOrigin, access.requireViewer] },
    (socket, request) => {
      const identity = access.identify(request);
      // Connecting counts as being seen, whatever the throttle says.
      if (identity.device) devices.touch(identity.device.id, false);
      hub.attach(socket, {
        ...(identity.local && { local: true }),
        ...(identity.device && { deviceId: identity.device.id }),
        ...(identity.phone && { phoneId: identity.phone.id }),
        ...(identity.hostSessionHash !== undefined && { sessionHash: identity.hostSessionHash }),
        stillAllowed: () => access.stillAllowed(identity),
      });
    },
  );
}
