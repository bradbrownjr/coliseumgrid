// What a push notification says (docs/PLAN.md, "Player view", "Push"). Pure, so the words are
// tested without a service worker, and the worker (src/worker/push-worker.ts) is built from
// this file. It imports only alertWords.ts, so the worker stays small.

import { calledWords, nextWords } from './alertWords.ts';

/** The page a notification opens. */
export const FOLLOW_PATH = '/follow';

/** The icon a notification shows (public/icons). */
export const NOTIFICATION_ICON = '/icons/icon-192.png';

/** What the server sends (packages/server/src/push-notify.ts, `PushPayload`). */
export interface PushAlert {
  alert: 'called' | 'next';
  handle: string;
  station: number | null;
}

export interface NotificationContent {
  title: string;
  body?: string;
  /** One per handle, so a newer alert replaces the older one. */
  tag: string;
}

// A handle is short; a payload with a long one isn't from the server.
const HANDLE_MAX = 64;

/**
 * The alert in a payload, or null when it isn't one the server sends. The payload comes
 * through the push service, so it is checked rather than trusted: a bad one must not throw
 * in the worker, because the browser needs a notification for every push.
 */
export function parsePushAlert(data: unknown): PushAlert | null {
  if (typeof data !== 'object' || data === null) return null;
  const { alert, handle, station } = data as Record<string, unknown>;
  if (alert !== 'called' && alert !== 'next') return null;
  if (typeof handle !== 'string' || handle.trim() === '' || handle.length > HANDLE_MAX) return null;
  if (station !== null && station !== undefined && !(typeof station === 'number' && Number.isInteger(station) && station > 0)) return null;
  return { alert, handle, station: station ?? null };
}

/** The notification for an alert, or a plain one when the payload wasn't readable. */
export function notificationFor(alert: PushAlert | null): NotificationContent {
  if (alert === null) return { title: 'ColiseumGrid', body: 'Open the page to check your match.', tag: 'coliseumgrid' };
  return {
    title: alert.alert === 'called' ? calledWords(alert.handle, alert.station) : nextWords(alert.handle),
    tag: `coliseumgrid-${alert.handle}`,
  };
}

/** True when a window's address is the player page (any query), so a click focuses it. */
export function isFollowPage(address: string, origin: string): boolean {
  try {
    const url = new URL(address, origin);
    return url.origin === origin && url.pathname === FOLLOW_PATH;
  } catch {
    return false;
  }
}
