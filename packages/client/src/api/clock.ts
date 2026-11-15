// The server's clock (docs/PLAN.md, "Waiting for a missing player"). A station's `calledAt` is the
// server's time, so a timer or a wait that read the laptop's, tablet's, or TV's own clock would
// be wrong by however far that clock is off. Every answer that carries a bracket or groups also
// carries the server's `now`; the difference to the local clock is kept here, and the screens
// ask `serverNow` instead of `Date.now`.

import type { Result } from './request.ts';

let offsetMs = 0;

/**
 * How far the server's clock is ahead of the local one, from an answer that said it was
 * `serverIso` when it was made. The server stamps an answer about halfway through the request,
 * so the local time to compare with is the middle of `sentMs` and `receivedMs`. Null when
 * `serverIso` isn't a time.
 */
export function clockOffset(serverIso: string, sentMs: number, receivedMs: number): number | null {
  const server = Date.parse(serverIso);
  return Number.isNaN(server) ? null : server - (sentMs + receivedMs) / 2;
}

/** The server's time now, in milliseconds, by the local clock and the offset learned so far. */
export const serverNow = (localMs: number = Date.now()): number => localMs + offsetMs;

/** Keeps the offset from an answer, or leaves it as it was when the time can't be read. */
export function noteServerTime(serverIso: string, sentMs: number, receivedMs: number): void {
  const offset = clockOffset(serverIso, sentMs, receivedMs);
  if (offset !== null) offsetMs = offset;
}

/** Back to a clock with no offset. For tests. */
export function resetServerClock(): void {
  offsetMs = 0;
}

/** Sends a call whose answer carries `now`, and learns the server's clock from the answer. */
export async function withServerClock<T extends { now: string }>(send: () => Promise<Result<T>>): Promise<Result<T>> {
  const sent = Date.now();
  const result = await send();
  if (result.ok) noteServerTime(result.data.now, sent, Date.now());
  return result;
}
