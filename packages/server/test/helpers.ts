// Shared by the tests that sign in or pair a device.

import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

export const HOST_PASSWORD = 'correct horse battery';

/** A remote address that is not the laptop. */
export const REMOTE = '198.51.100.7';

/** The "name=value" part of a response's Set-Cookie, ready for a Cookie header. */
export function cookieFrom(res: LightMyRequestResponse): string {
  const header = res.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  expect(value, 'a Set-Cookie header').toBeTypeOf('string');
  return (value as string).split(';')[0] as string;
}

/** Signs in with the host password and returns the cg_host cookie. */
export async function signInHost(app: FastifyInstance, remoteAddress = REMOTE): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/host/sign-in',
    payload: { password: HOST_PASSWORD },
    remoteAddress,
  });
  expect(res.statusCode).toBe(204);
  return cookieFrom(res);
}

/** Makes a code as the host and pairs a device with it. Returns the cg_device cookie and the device. */
export async function pairDevice(
  app: FastifyInstance,
  hostCookie: string,
  role: 'display' | 'signup',
  remoteAddress = REMOTE,
): Promise<{ cookie: string; device: { id: number; role: string; label: string; lastSeen: string } }> {
  const made = await app.inject({
    method: 'POST',
    url: '/api/pairing/codes',
    payload: { role },
    headers: { cookie: hostCookie },
    remoteAddress,
  });
  expect(made.statusCode).toBe(201);
  const joined = await app.inject({
    method: 'POST',
    url: '/api/devices/join',
    payload: { code: made.json().code },
    remoteAddress,
  });
  expect(joined.statusCode).toBe(201);
  return { cookie: cookieFrom(joined), device: joined.json().device };
}

/** inject() with a Cookie header added. */
export function withCookie(app: FastifyInstance, cookie: string, options: InjectOptions) {
  return app.inject({ remoteAddress: REMOTE, ...options, headers: { cookie, ...options.headers } });
}
