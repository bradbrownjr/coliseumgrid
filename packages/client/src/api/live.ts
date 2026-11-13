// The pure parts of the live connection (docs/PLAN.md, "Live messages"). The hook that opens the
// WebSocket is components/useLive.ts.

import type { LiveMessage } from '@coliseumgrid/core';

/** The first wait after a drop, and the longest wait between tries. */
export const RECONNECT_MIN_MS = 1000;
export const RECONNECT_MAX_MS = 30 * 1000;

/**
 * How long to wait before the next try, after `attempt` failed tries in a row (0 for the first
 * retry). The wait doubles from 1 second up to 30 seconds. Half of it is fixed and half is
 * random, so a room of screens that lost the laptop together don't all knock at the same
 * moment when it comes back ("equal jitter").
 * (https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(RECONNECT_MIN_MS * 2 ** attempt, RECONNECT_MAX_MS);
  return ceiling / 2 + random() * (ceiling / 2);
}

/** ws or wss to match the page, so a page over HTTPS never opens a plain socket. */
export function liveUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/live`;
}

/** The message in a frame, or null for anything that isn't one the server sends. */
export function parseLiveMessage(data: unknown): LiveMessage | null {
  if (typeof data !== 'string') return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;
  const message = json as { type?: unknown; event?: unknown };
  if (message.type === 'players' || message.type === 'unpaired' || message.type === 'bracket' || message.type === 'heats') {
    return { type: message.type };
  }
  if (message.type !== 'event') return null;
  if (message.event === null) return { type: 'event', event: null };
  const event = message.event as { name?: unknown } | undefined;
  if (typeof event === 'object' && event !== null && typeof event.name === 'string') {
    return { type: 'event', event: { name: event.name } };
  }
  return null;
}
