// The one way the client calls the API. Paths are relative, so the same build works from the
// laptop, the tablet, the TV, and a hosted server. Every call resolves to a Result: a screen
// switches on `ok` and `error`, and never has to catch.

import type { ApiErrorCode } from '@coliseumgrid/core';
import { isApiErrorCode, isHandleRefusal, type Failure } from './errors.ts';

export type Result<T> = { ok: true; data: T } | Failure;

const notSignedInListeners = new Set<() => void>();

/**
 * Runs `listener` whenever any call is answered 401 not-signed-in: the host's session ended, or
 * the device was unpaired. The host screen goes back to the sign-in panel; a paired screen goes
 * to the join screen. Returns the function that stops listening.
 */
export function onNotSignedIn(listener: () => void): () => void {
  notSignedInListeners.add(listener);
  return () => {
    notSignedInListeners.delete(listener);
  };
}

/**
 * `body` is sent as JSON, or as it is when it is a `Blob` (a picked file): the event graphic is
 * the one raw upload, and its type goes in `Content-Type` (docs/PLAN.md, "The event graphic").
 */
export async function call<T>(method: string, path: string, body?: object): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      // Sign-in and pairing live in cookies (docs/PLAN.md, "Devices and host API"). Same-origin
      // is the default; it is written out because nothing here works without it.
      credentials: 'same-origin',
      ...(body instanceof Blob
        ? { headers: { 'content-type': body.type }, body }
        : body && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, error: 'failed' };
  }

  // 204 has no body: sign-in, sign-out, and unpairing answer with just the status.
  if (response.status === 204) return { ok: true, data: undefined as T };

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
  if (error === 'not-signed-in') for (const listener of notSignedInListeners) listener();
  if (error === 'refused' && isHandleRefusal(answer.reason)) return { ok: false, error, reason: answer.reason };
  return { ok: false, error };
}
