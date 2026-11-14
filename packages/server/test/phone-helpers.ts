// Shared by the phone tests (docs/PLAN.md, "Phone API"): players with a real PIN, a caller for a
// phone, and a live connection as a phone. PINs are hashed with scrypt at the production cost,
// so the helper hashes once and gives every player the same PIN.

import type { LiveMessage } from '@coliseumgrid/core';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import type { Database } from '../src/database.ts';
import { hashPin } from '../src/pin-hash.ts';
import type { Api } from './bracket-api-helpers.ts';
import { cookieFrom } from './helpers.ts';

export const PIN = '1234';
const PIN_HASH = await hashPin(PIN);

/** A phone's address, and others for tests that need several callers. */
export const PHONE_IP = '198.51.100.20';
export const otherIp = (n: number): string => `203.0.113.${n}`;

/** Adds `count` players straight to the table, named Player1, Player2, ..., all with the PIN `PIN`. */
export function addPinPlayers(db: Database, count: number, from = 1): number[] {
  const insert = db.prepare('INSERT INTO players (handle, handle_key, pin_hash, created_at) VALUES (?, ?, ?, ?)');
  return Array.from({ length: count }, (_, i) => {
    const handle = `Player${from + i}`;
    return Number(insert.run(handle, handle.toLowerCase(), PIN_HASH, 't').lastInsertRowid);
  });
}

/** A caller from `remoteAddress` that sends `cookie` (when there is one) and `headers` with every request. */
export function from(app: FastifyInstance, remoteAddress: string, cookie?: string, headers: Record<string, string> = {}): Api {
  return (method, url, payload) =>
    app.inject({
      method,
      url,
      remoteAddress,
      ...(payload && { payload }),
      headers: { ...(cookie && { cookie }), ...headers },
    });
}

export interface Phone {
  api: Api;
  cookie: string;
  /** The Set-Cookie header the sign-in answered with. */
  setCookie: string;
}

/** Signs a phone in by handle and PIN and checks it worked. */
export async function signInPhone(app: FastifyInstance, handle: string, remoteAddress = PHONE_IP, headers: Record<string, string> = {}): Promise<Phone> {
  const res = await from(app, remoteAddress, undefined, headers)('POST', '/api/phone/follow', { handle, pin: PIN });
  expect(res.statusCode, res.body).toBe(201);
  const cookie = cookieFrom(res);
  return { api: from(app, remoteAddress, cookie, headers), cookie, setCookie: res.headers['set-cookie'] as string };
}

export const handlesOf = (res: LightMyRequestResponse): string[] =>
  (res.json().following as { handle: string }[]).map((p) => p.handle);

/** The parts of the ws client the tests use. */
interface WebSocketLike {
  on(event: 'message', listener: (data: Buffer) => void): unknown;
  on(event: 'close', listener: (code: number) => void): unknown;
}

export interface Live {
  messages: LiveMessage[];
  closed: { code: number } | undefined;
  terminate(): void;
}

/** Opens GET /api/live over injectWS. Rejects with the status when the handshake is refused. */
export async function listen(
  app: FastifyInstance,
  cookie: string | undefined,
  remoteAddress = PHONE_IP,
  extraHeaders: Record<string, string> = {},
): Promise<Live> {
  const live: Live = { messages: [], closed: undefined, terminate: () => undefined };
  const ws = await app.injectWS(
    '/api/live',
    { headers: { ...(cookie && { cookie }), host: 'localhost', ...extraHeaders }, socket: { remoteAddress } } as never,
    {
      onInit: (socket: WebSocketLike) => {
        socket.on('message', (data) => live.messages.push(JSON.parse(data.toString()) as LiveMessage));
        socket.on('close', (code) => {
          live.closed = { code };
        });
      },
    },
  );
  live.terminate = () => ws.terminate();
  return live;
}

/** Polls until `check` stops throwing, up to `ms`. */
export async function eventually(check: () => void, ms = 1000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > end) throw error;
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}
