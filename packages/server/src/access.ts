// Who is making a request (docs/PLAN.md, "Host sign-in" and "Devices and host API"), and the
// hooks that keep a route to the people it is for. A request is the host when it carries a
// valid cg_host session cookie, or (offline only) comes from the laptop itself. It is a device
// when it carries a cg_device cookie that matches a paired device. A browser can be both.

import type { Device } from '@coliseumgrid/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { fail } from './api-schemas.ts';
import { parseCookies, serializeCookie } from './cookies.ts';
import type { Mode } from './config.ts';
import type { Devices } from './devices.ts';
import { HOST_SESSION_MS, type HostStore } from './host-store.ts';
import { hashPin, verifyPin } from './pin-hash.ts';
import { isHttps, isLocalRequest } from './request-info.ts';
import { hashToken, newToken } from './tokens.ts';

export const HOST_COOKIE = 'cg_host';
export const DEVICE_COOKIE = 'cg_device';

// A device token lasts until the host unpairs it, so its cookie gets the longest life a
// browser allows: Chrome shortens anything longer to 400 days
// (https://developer.chrome.com/blog/cookie-max-age-expires). The server never expires it.
const DEVICE_COOKIE_SECONDS = 400 * 24 * 60 * 60;
const HOST_COOKIE_SECONDS = HOST_SESSION_MS / 1000;

export interface Identity {
  /** Signed in as the host, by cookie or by being the laptop. */
  host: boolean;
  /** Hash of the cg_host session, when the host is signed in by cookie. */
  hostSessionHash?: string;
  /** Offline and from the laptop itself. */
  local: boolean;
  device?: Device;
}

export interface Access {
  identify(request: FastifyRequest): Identity;
  /** onRequest hooks: they answer 401 not-signed-in, before the body is read. */
  requireHost(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined>;
  requireSignup(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined>;
  requireHostOrDevice(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined>;
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
  /** Whether the identity still holds, for a connection that has been open a while. */
  stillAllowed(identity: Identity): boolean;
}

export interface AccessOptions {
  mode: Mode;
  hostStore: HostStore;
  devices: Devices;
  /** The password from the environment. When set it is the password and setup is off. */
  hostPassword?: string;
  trustedProxy?: string;
}

export async function createAccess(options: AccessOptions): Promise<Access> {
  const { mode, hostStore, devices, trustedProxy } = options;
  // Hashed once at startup, so the plain text isn't kept and the check costs the same as a
  // stored password's.
  const envHash = options.hostPassword === undefined ? undefined : await hashPin(options.hostPassword);
  const currentHash = (): string | undefined => envHash ?? hostStore.getPasswordHash();

  // Several hooks and the handler all ask who the caller is; ask the database once per request.
  const cache = new WeakMap<FastifyRequest, Identity>();

  function identify(request: FastifyRequest): Identity {
    const cached = cache.get(request);
    if (cached) return cached;
    const cookies = parseCookies(request.headers.cookie);
    const local = isLocalRequest(request, mode);

    const hostToken = cookies.get(HOST_COOKIE);
    const hostHash = hostToken === undefined ? undefined : hashToken(hostToken);
    const hasSession = hostHash !== undefined && hostStore.sessionValid(hostHash);

    const deviceToken = cookies.get(DEVICE_COOKIE);
    const device = deviceToken === undefined ? undefined : devices.getByTokenHash(hashToken(deviceToken));
    // Device activity counts as the device being seen; the write is throttled.
    if (device) devices.touch(device.id, true);

    const identity: Identity = {
      host: hasSession || local,
      local,
      ...(hasSession && { hostSessionHash: hostHash }),
      ...(device && { device }),
    };
    cache.set(request, identity);
    return identity;
  }

  const guard =
    (allowed: (identity: Identity) => boolean) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> =>
      allowed(identify(request)) ? undefined : fail(reply, 401, 'not-signed-in');

  const secure = (request: FastifyRequest) => isHttps(request, trustedProxy);

  return {
    identify,
    requireHost: guard((who) => who.host),
    // A Display can't create players or claim handles; only Sign-up devices and the host can.
    requireSignup: guard((who) => who.host || who.device?.role === 'signup'),
    requireHostOrDevice: guard((who) => who.host || who.device !== undefined),
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
    stillAllowed(identity) {
      const hostOk = identity.local || (identity.hostSessionHash !== undefined && hostStore.sessionValid(identity.hostSessionHash));
      const deviceOk = identity.device !== undefined && devices.get(identity.device.id) !== undefined;
      return hostOk || deviceOk;
    },
  };
}
