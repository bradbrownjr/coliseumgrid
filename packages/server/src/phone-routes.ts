// The phone API (docs/PLAN.md, "Phone API"): sign in by handle and PIN or by a follow code,
// follow up to PHONE_FOLLOWS_MAX players, read one narrow answer about the competition, and
// subscribe to push. A phone is not a device, so none of these routes need a host or a device,
// and a phone can't call any route that does. A player leaves the server as `{ id, handle }`
// only, and every body and answer has a closed schema (CLAUDE.md, rule 1).

import {
  checkHandle,
  parseJoinCode,
  PHONE_FOLLOWS_MAX,
  playerStatus,
  type ApiError,
  type FollowCodeBody,
  type HandlePinBody,
  type PhoneAnswer,
  type PhoneFollowingAnswer,
  type PhonePushKeyAnswer,
  type PhoneStandings,
  type PushSubscriptionBody,
} from '@coliseumgrid/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Access } from './access.ts';
import {
  errorSchema,
  fail,
  followBodySchema,
  followCodeBodySchema,
  followingAnswerSchema,
  phoneAnswerSchema,
  playerIdParams,
  pushKeyAnswerSchema,
  pushSubscriptionBodySchema,
} from './api-schemas.ts';
import { getClientKey } from './client-ip.ts';
import type { Competition } from './competition.ts';
import type { Events } from './events.ts';
import type { FollowCodes } from './follow-codes.ts';
import type { LiveHub } from './live.ts';
import type { PinGuard } from './pin-guard.ts';
import type { Phones } from './phones.ts';
import type { Players } from './players.ts';
import type { Push } from './push-notify.ts';
import type { PushSubscriptions } from './push-subscriptions.ts';
import { ALL_CALLERS, type JoinLimits } from './rate-limit.ts';
import { isHttps } from './request-info.ts';
import { hashToken, newToken } from './tokens.ts';

export interface PhoneRoutesOptions {
  access: Access;
  phones: Phones;
  followCodes: FollowCodes;
  pushSubscriptions: PushSubscriptions;
  players: Players;
  events: Events;
  competition: Competition;
  hub: LiveHub;
  pinGuard: PinGuard;
  /** The wrong-code limits, shared with the pairing codes. */
  joinLimits: JoinLimits;
  push: Push;
  /** See getClientKey. */
  trustedProxy?: string;
}

const refusedOrBadRequest = errorSchema(['refused', 'bad-request'], true);
const badRequest = errorSchema(['bad-request']);
const notFollowing = errorSchema(['not-following']);

/** The bytes of an unpadded base64url string, or null when it is anything else. */
function base64urlBytes(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  // A string with stray bits at the end decodes, but isn't what a browser sends.
  return bytes.toString('base64url') === value ? bytes : null;
}

/**
 * True when the keys are what a browser's PushSubscription gives: `p256dh` an uncompressed P-256
 * point (65 bytes starting 0x04) and `auth` 16 bytes, both base64url (RFC 8291 sections 3.1 and
 * 3.2, https://www.rfc-editor.org/rfc/rfc8291). The sender fails every time on keys that aren't.
 */
function validKeys(keys: PushSubscriptionBody['keys']): boolean {
  const p256dh = base64urlBytes(keys.p256dh);
  const auth = base64urlBytes(keys.auth);
  return p256dh !== null && p256dh.length === 65 && p256dh[0] === 0x04 && auth !== null && auth.length === 16;
}

export async function registerPhoneRoutes(app: FastifyInstance, options: PhoneRoutesOptions): Promise<void> {
  const { access, phones, followCodes, pushSubscriptions, players, events, competition, hub, pinGuard, joinLimits, push, trustedProxy } =
    options;
  const tooManyTries = errorSchema(['too-many-tries']);

  /**
   * Adds the follow to the request's phone, or makes a phone (and its cookie) when the request
   * has none. Returns the phone's id, or `full`. It looks the phone up again: the caller may
   * have awaited, and the phone may have signed out meanwhile.
   */
  function addFollow(request: FastifyRequest, reply: FastifyReply, playerId: number): number | 'full' {
    const phone = access.identify(request).phone;
    if (phone && phones.get(phone.id)) {
      if (phones.follow(phone.id, playerId) === 'full') return 'full';
      // The phone may have alerts on, which now count for this player too.
      pushSubscriptions.trimPlayer(playerId);
      return phone.id;
    }
    const token = newToken();
    const id = phones.create(hashToken(token), playerId);
    access.setPhoneCookie(request, reply, token);
    return id;
  }

  // Signing in ----------------------------------------------------------------------------

  app.post<{ Body: HandlePinBody; Reply: PhoneFollowingAnswer | ApiError }>(
    '/api/phone/follow',
    {
      schema: {
        body: followBodySchema,
        response: {
          201: followingAnswerSchema,
          400: refusedOrBadRequest,
          401: errorSchema(['wrong-pin']),
          409: errorSchema(['too-many-handles']),
          429: tooManyTries,
        },
      },
    },
    async (request, reply) => {
      const check = checkHandle(request.body.handle);
      if (!check.ok) return reply.code(400).send({ error: 'refused', reason: check.reason } satisfies ApiError);
      // Reserved up front. Only wrong tries stay counted, so one address can't walk through the
      // handles; a follow that works gives its try back (refundFollowFrom).
      const ip = getClientKey(request, trustedProxy);
      if (!pinGuard.allowFollowFrom(ip)) return fail(reply, 429, 'too-many-tries');
      const player = players.getByKey(check.key);

      const phone = access.identify(request).phone;
      const following = phone ? phones.following(phone.id) : [];
      // A phone that already follows them has nothing to prove.
      if (player && following.some((p) => p.id === player.id)) {
        pinGuard.refundFollowFrom(ip);
        return reply.code(201).send({ following });
      }
      // Asked of every handle, known or not, so the answer says nothing about who exists.
      if (following.length >= PHONE_FOLLOWS_MAX) {
        pinGuard.refundFollowFrom(ip);
        return fail(reply, 409, 'too-many-handles');
      }

      // An unknown handle and a wrong PIN get one answer (docs/PLAN.md, "Player view").
      if (!player) return fail(reply, 401, await pinGuard.rejectUnknownHandle(request.body.pin));
      const verdict = await pinGuard.checkFollow(check.key, player.pinHash, request.body.pin);
      if (verdict === 'too-many-tries') return fail(reply, 429, 'too-many-tries');
      if (verdict === 'wrong-pin') return fail(reply, 401, 'wrong-pin');
      pinGuard.refundFollowFrom(ip);
      const id = addFollow(request, reply, player.id);
      if (id === 'full') return fail(reply, 409, 'too-many-handles');
      return reply.code(201).send({ following: phones.following(id) });
    },
  );

  app.post<{ Body: FollowCodeBody; Reply: PhoneFollowingAnswer | ApiError }>(
    '/api/phone/follow-code',
    {
      schema: {
        body: followCodeBodySchema,
        response: {
          201: followingAnswerSchema,
          400: badRequest,
          404: errorSchema(['wrong-code']),
          409: errorSchema(['too-many-handles']),
          429: tooManyTries,
        },
      },
    },
    async (request, reply) => {
      // Checked before the code is spent, so a full phone doesn't burn a good code.
      const phone = access.identify(request).phone;
      if (phone && phones.count(phone.id) >= PHONE_FOLLOWS_MAX) return fail(reply, 409, 'too-many-handles');

      const ip = getClientKey(request, trustedProxy);
      // Both are reserved up front, and everything up to the answer is synchronous.
      if (!joinLimits.perIp.tryAttempt(ip) || !joinLimits.all.tryAttempt(ALL_CALLERS)) return fail(reply, 429, 'too-many-tries');
      // A code that can't be read counts as a wrong guess, like one that isn't live.
      const code = parseJoinCode(request.body.code);
      const playerId = code === null ? null : followCodes.spend(code);
      if (playerId === null) return fail(reply, 404, 'wrong-code');
      // Only wrong codes count, so a right one gives back its slot on both counts. Clearing the
      // address's count would also forget its wrong pairing codes, which share it.
      joinLimits.perIp.refund(ip);
      joinLimits.all.refund(ALL_CALLERS);
      const id = addFollow(request, reply, playerId);
      if (id === 'full') return fail(reply, 409, 'too-many-handles');
      return reply.code(201).send({ following: phones.following(id) });
    },
  );

  // Reading and leaving -------------------------------------------------------------------

  app.get<{ Reply: PhoneAnswer | ApiError }>(
    '/api/phone',
    {
      onRequest: access.requirePhone,
      schema: { response: { 200: phoneAnswerSchema, 401: notFollowing } },
    },
    async (request) => {
      const answer = await competition.answer();
      const phone = access.identify(request).phone;
      const following = phone ? phones.following(phone.id) : [];
      let standings: PhoneStandings | null = null;
      if (answer && 'matches' in answer) {
        standings = { kind: 'bracket', format: answer.format, finished: answer.finished, rows: answer.standings };
      } else if (answer) {
        standings = { kind: 'heats', finished: answer.finished, rows: answer.standings, finalSize: answer.finalSize };
      }
      return {
        event: events.current(),
        following: following.map((player) => ({ player, ...playerStatus(answer, player.id) })),
        standings,
      };
    },
  );

  app.delete<{ Params: { playerId: string }; Reply: PhoneFollowingAnswer | ApiError }>(
    '/api/phone/follow/:playerId',
    {
      onRequest: access.requirePhone,
      schema: {
        params: playerIdParams,
        response: { 200: followingAnswerSchema, 400: badRequest, 401: notFollowing, 404: errorSchema(['not-found']) },
      },
    },
    async (request, reply) => {
      const phone = access.identify(request).phone;
      if (!phone) return fail(reply, 401, 'not-following');
      const result = phones.unfollow(phone.id, Number(request.params.playerId));
      if (result === 'not-following') return fail(reply, 404, 'not-found');
      if (result === 'signed-out') {
        // The last follow was the sign-in.
        access.clearPhoneCookie(request, reply);
        hub.signOutPhone(phone.id);
        return { following: [] };
      }
      return { following: phones.following(phone.id) };
    },
  );

  app.post(
    '/api/phone/sign-out',
    { onRequest: access.requirePhone, schema: { response: { 204: { type: 'null' }, 401: notFollowing } } },
    async (request, reply) => {
      const phone = access.identify(request).phone;
      if (phone) {
        phones.remove(phone.id);
        hub.signOutPhone(phone.id);
      }
      access.clearPhoneCookie(request, reply);
      return reply.code(204).send();
    },
  );

  // Push ----------------------------------------------------------------------------------

  /** Push is offered to a request only online, over HTTPS, with a subject set and a key that loads. */
  const pushOn = (request: FastifyRequest): boolean =>
    push.enabled && isHttps(request, trustedProxy) && push.vapid() !== undefined;

  app.get<{ Reply: PhonePushKeyAnswer | ApiError }>(
    '/api/phone/push',
    { onRequest: access.requirePhone, schema: { response: { 200: pushKeyAnswerSchema, 401: notFollowing } } },
    async (request) => ({ publicKey: pushOn(request) ? (push.vapid()?.publicKey ?? null) : null }),
  );

  app.put<{ Body: PushSubscriptionBody }>(
    '/api/phone/push',
    {
      onRequest: access.requirePhone,
      schema: {
        body: pushSubscriptionBodySchema,
        response: { 204: { type: 'null' }, 400: badRequest, 401: notFollowing, 409: errorSchema(['push-off']) },
      },
    },
    async (request, reply) => {
      const phone = access.identify(request).phone;
      if (!phone) return fail(reply, 401, 'not-following');
      if (!pushOn(request)) return fail(reply, 409, 'push-off');
      const { endpoint, keys } = request.body;
      // The server POSTs to this address, so it must be a push service's (CLAUDE.md, rule 3).
      if (!push.isAllowedEndpoint(endpoint) || !validKeys(keys)) return fail(reply, 400, 'bad-request');
      pushSubscriptions.set(phone.id, { endpoint, p256dh: keys.p256dh, auth: keys.auth });
      return reply.code(204).send();
    },
  );

  app.delete(
    '/api/phone/push',
    { onRequest: access.requirePhone, schema: { response: { 204: { type: 'null' }, 401: notFollowing } } },
    async (request, reply) => {
      const phone = access.identify(request).phone;
      if (phone) pushSubscriptions.remove(phone.id);
      return reply.code(204).send();
    },
  );
}
