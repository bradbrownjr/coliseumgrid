// Who is making a request (docs/PLAN.md, "Host sign-in" and "Devices and host API"), and the
// hooks that keep a route to the people it is for. A request is the host when it carries a
// valid cg_host session cookie, or (offline only) comes from the laptop itself. It is a device
// when it carries a cg_device cookie that matches a paired device, and a phone when it carries a
// cg_phone cookie that matches a phone that follows someone (docs/PLAN.md, "Phone API"). A
// browser can be several.

import type { Device } from '@coliseumgrid/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { fail } from './api-schemas.ts';
import { parseCookies, serializeCookie } from './cookies.ts';
import type { Mode } from './config.ts';
import type { Devices } from './devices.ts';
import { HOST_SESSION_MS, type HostStore } from './host-store.ts';
import type { PhoneRow, Phones } from './phones.ts';
import { hashPin, verifyPin } from './pin-hash.ts';
import { hasForeignOrigin, isHttps, isLocalRequest } from './request-info.ts';
import { hashToken, newToken } from './tokens.ts';

export const HOST_COOKIE = 'cg_host';
export const DEVICE_COOKIE = 'cg_device';
export const PHONE_COOKIE = 'cg_phone';

// A device token lasts until the host unpairs it, so its cookie gets the longest life a
// browser allows: Chrome shortens anything longer to 400 days
// (https://developer.chrome.com/blog/cookie-max-age-expires). The server never expires it.
const DEVICE_COOKIE_SECONDS = 400 * 24 * 60 * 60;
const PHONE_COOKIE_SECONDS = DEVICE_COOKIE_SECONDS;
const HOST_COOKIE_SECONDS = HOST_SESSION_MS / 1000;

/**
 * An onRequest hook: answers 403 forbidden to a request sent by a page on another origin
 * (see hasForeignOrigin). It runs before the body is read, and before anyone is identified.
 */
export async function rejectForeignOrigin(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  return hasForeignOrigin(request.headers) ? fail(reply, 403, 'forbidden') : undefined;
}

export interface Identity {
  /** Signed in as the host, by cookie or by being the laptop. */
  host: boolean;
  /** Hash of the cg_host session, when the host is signed in by cookie. */
  hostSessionHash?: string;
  /** Offline and from the laptop itself. */
  local: boolean;
  device?: Device;
  /** A phone that follows someone. */
  phone?: PhoneRow;
}

export interface Access {
  identify(request: FastifyRequest): Identity;
  /** onRequest hooks: they answer 401 not-signed-in, before the body is read. */
  requireHost(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined>;
  requireSignup(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined>;
  requireHostOrDevice(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined>;
  /** Host, device, or phone: for the two routes a phone shares with the screens, GET /api/event and /api/live. */
  requireViewer(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined>;
  /** A phone that follows someone, else 401 not-following. */
  requirePhone(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined>;
  passwordSet(): boolean;
  /** True only offline, from the laptop, with no password yet. */
  canSetUp(request: FastifyRequest): boolean;
  /** Stores the first password. False when one was already set. */
  setPassword(password: string): Promise<boolean>;
  verifyPassword(password: string): Promise<boolean>;
  /** Starts a host session and sets its cookie. */
  startHostSession(request: FastifyRequest, reply: FastifyReply): void;
  /** Ends the request's host session, if it has one, and clears the cookie. Returns the ended session's hash. */
  endHostSession(request: FastifyRequest, reply: FastifyReply): string | undefined;
  /** Sets the device cookie for a newly paired device. */
  setDeviceCookie(request: FastifyRequest, reply: FastifyReply, token: string): void;
  /** Sets the phone cookie for a newly made phone. */
  setPhoneCookie(request: FastifyRequest, reply: FastifyReply, token: string): void;
  /** Clears the phone cookie, for a sign-out. */
  clearPhoneCookie(request: FastifyRequest, reply: FastifyReply): void;
  /** Whether the identity is the host right now: the laptop itself, or a host session that hasn't ended or expired. */
  hostStillAllowed(identity: Identity): boolean;
  /** Whether the identity still holds, for a connection that has been open a while. */
  stillAllowed(identity: Identity): boolean;
}

export interface AccessOptions {
  mode: Mode;
  hostStore: HostStore;
  devices: Devices;
  phones: Phones;
  /** The password from the environment. When set it is the password and setup is off. */
  hostPassword?: string;
  trustedProxy?: string;
}

export async function createAccess(options: AccessOptions): Promise<Access> {
  const { mode, hostStore, devices, phones, trustedProxy } = options;
  // Hashed once at startup, so the plain text isn't kept and the check costs the same as a
  // stored password's.
  const envHash = options.hostPassword === undefined ? undefined : await hashPin(options.hostPassword);
  // A session outlives a restart, so when the variable names a different password than the
  // one the sessions were made under, they must end. The stored hash records which password
  // that was; if the variable doesn't match it, store the new one and drop every session.
  if (envHash !== undefined && options.hostPassword !== undefined) {
    const stored = hostStore.getPasswordHash();
    if (stored === undefined || !(await verifyPin(options.hostPassword, stored))) hostStore.replacePasswordHash(envHash);
  }
  const currentHash = (): string | undefined => envHash ?? hostStore.getPasswordHash();

  // Several hooks and the handler all ask who the caller is; ask the database once per request.
  const cache = new WeakMap<FastifyRequest, Identity>();

  function identify(request: FastifyRequest): Identity {
    const cached = cache.get(request);
    if (cached) return cached;
    const cookies = parseCookies(request.headers.cookie);
    const local = isLocalRequest(request, mode);

    // A name can hold several values (cookie tossing, see parseCookies): the first one that is
    // a real session or device is the one.
    let hostHash: string | undefined;
    for (const token of cookies.get(HOST_COOKIE) ?? []) {
      const hash = hashToken(token);
      if (hostStore.sessionValid(hash)) {
        hostHash = hash;
        break;
      }
    }
    const hasSession = hostHash !== undefined;

    let device: Device | undefined;
    for (const token of cookies.get(DEVICE_COOKIE) ?? []) {
      device = devices.getByTokenHash(hashToken(token));
      if (device) break;
    }
    // Device activity counts as the device being seen; the write is throttled.
    if (device) devices.touch(device.id, true);

    let phone: PhoneRow | undefined;
    for (const token of cookies.get(PHONE_COOKIE) ?? []) {
      phone = phones.getByTokenHash(hashToken(token));
      if (phone) break;
    }
    if (phone) phones.touch(phone.id, true);

    const identity: Identity = {
      host: hasSession || local,
      local,
      ...(hasSession && { hostSessionHash: hostHash }),
      ...(device && { device }),
      ...(phone && { phone }),
    };
    cache.set(request, identity);
    return identity;
  }

  const guard =
    (allowed: (identity: Identity) => boolean, error: 'not-signed-in' | 'not-following' = 'not-signed-in') =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> =>
      allowed(identify(request)) ? undefined : fail(reply, 401, error);

  const secure = (request: FastifyRequest) => isHttps(request, trustedProxy);

  const hostStillAllowed = (identity: Identity): boolean =>
    identity.local || (identity.hostSessionHash !== undefined && hostStore.sessionValid(identity.hostSessionHash));

  return {
    identify,
    requireHost: guard((who) => who.host),
    // A Display can't create players or claim handles; only Sign-up devices and the host can.
    requireSignup: guard((who) => who.host || who.device?.role === 'signup'),
    requireHostOrDevice: guard((who) => who.host || who.device !== undefined),
    requireViewer: guard((who) => who.host || who.device !== undefined || who.phone !== undefined),
    requirePhone: guard((who) => who.phone !== undefined, 'not-following'),
    passwordSet: () => currentHash() !== undefined,
    canSetUp: (request) => envHash === undefined && hostStore.getPasswordHash() === undefined && identify(request).local,
    async setPassword(password) {
      if (envHash !== undefined) return false;
      return hostStore.setPasswordHash(await hashPin(password));
    },
    async verifyPassword(password) {
      const hash = currentHash();
      return hash !== undefined && (await verifyPin(password, hash));
    },
    startHostSession(request, reply) {
      const token = newToken();
      hostStore.createSession(hashToken(token));
      reply.header('set-cookie', serializeCookie(HOST_COOKIE, token, { maxAgeSeconds: HOST_COOKIE_SECONDS, secure: secure(request) }));
    },
    endHostSession(request, reply) {
      const hash = identify(request).hostSessionHash;
      if (hash !== undefined) hostStore.deleteSession(hash);
      reply.header('set-cookie', serializeCookie(HOST_COOKIE, 'x', { maxAgeSeconds: 0, secure: secure(request) }));
      return hash;
    },
    setDeviceCookie(request, reply, token) {
      reply.header('set-cookie', serializeCookie(DEVICE_COOKIE, token, { maxAgeSeconds: DEVICE_COOKIE_SECONDS, secure: secure(request) }));
    },
    setPhoneCookie(request, reply, token) {
      reply.header('set-cookie', serializeCookie(PHONE_COOKIE, token, { maxAgeSeconds: PHONE_COOKIE_SECONDS, secure: secure(request) }));
    },
    clearPhoneCookie(request, reply) {
      reply.header('set-cookie', serializeCookie(PHONE_COOKIE, 'x', { maxAgeSeconds: 0, secure: secure(request) }));
    },
    hostStillAllowed,
    stillAllowed(identity) {
      const hostOk = hostStillAllowed(identity);
      const deviceOk = identity.device !== undefined && devices.get(identity.device.id) !== undefined;
      const phoneOk = identity.phone !== undefined && phones.get(identity.phone.id) !== undefined;
      return hostOk || deviceOk || phoneOk;
    },
  };
}
