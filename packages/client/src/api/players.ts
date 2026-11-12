// Calls to the players API (docs/PLAN.md, section 4). Paths are relative, so the same build
// works from the laptop, the tablet, and a hosted server. Every call resolves to a Result:
// a screen switches on `ok` and `error`, and never has to catch.

import type {
  ApiErrorCode,
  HandleBody,
  HandlePinBody,
  MergeBody,
  NewPlayerAnswer,
  PinAnswer,
  Player,
  PlayerAnswer,
  PlayersAnswer,
  SignupCheckAnswer,
} from '@coliseumgrid/core';
import { isApiErrorCode, isHandleRefusal, type Failure } from './errors.ts';

export type Result<T> = { ok: true; data: T } | Failure;

async function call<T>(method: string, path: string, body?: object): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      ...(body && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, error: 'failed' };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, error: 'failed' };
  }

  if (response.ok) return { ok: true, data: json as T };

  const answer = (json ?? {}) as { error?: unknown; reason?: unknown };
  if (!isApiErrorCode(answer.error)) return { ok: false, error: 'failed' };
  const error: ApiErrorCode = answer.error;
  if (error === 'refused' && isHandleRefusal(answer.reason)) return { ok: false, error, reason: answer.reason };
  return { ok: false, error };
}

export const checkSignup = (handle: string) =>
  call<SignupCheckAnswer>('POST', '/api/signup/check', { handle } satisfies HandleBody);

export const signUp = (handle: string, pin: string) =>
  call<PlayerAnswer>('POST', '/api/signup', { handle, pin } satisfies HandlePinBody);

export const claimHandle = (handle: string, pin: string) =>
  call<PlayerAnswer>('POST', '/api/signup/claim', { handle, pin } satisfies HandlePinBody);

export const listPlayers = () => call<PlayersAnswer>('GET', '/api/players');

export const addPlayer = (handle: string) =>
  call<NewPlayerAnswer>('POST', '/api/players', { handle } satisfies HandleBody);

export const renamePlayer = (id: number, handle: string) =>
  call<PlayerAnswer>('PATCH', `/api/players/${id}`, { handle } satisfies HandleBody);

/** Deletes player `id` and keeps `intoId`. The server answers with the player kept. */
export const mergePlayer = (id: number, intoId: number) =>
  call<PlayerAnswer>('POST', `/api/players/${id}/merge`, { intoId } satisfies MergeBody);

export const resetPin = (id: number) => call<PinAnswer>('POST', `/api/players/${id}/reset-pin`);

export type { Player };
