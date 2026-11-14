// Deleting phones nobody has used for PHONE_IDLE_MAX_MS (phones.ts): once at startup and once a
// day after that. A server that runs for weeks at a venue never restarts, so startup alone
// would not be enough.

import { PHONE_IDLE_MAX_MS, type Phones } from './phones.ts';

export const PHONE_PURGE_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Purges now, then every `everyMs`. `onPurged` gets the ids of the phones deleted, so their live
 * connections can be closed. A failed purge is logged and tried again the next day. Returns a
 * function that stops the schedule.
 */
export function startPhonePurge(
  phones: Phones,
  onPurged: (phoneIds: number[]) => void,
  warn: (message: string) => void,
  everyMs: number = PHONE_PURGE_EVERY_MS,
): () => void {
  const run = (): void => {
    try {
      const ids = phones.purgeIdle(PHONE_IDLE_MAX_MS);
      if (ids.length > 0) onPurged(ids);
    } catch (error) {
      warn(`Idle phones could not be purged: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  run();
  const timer = setInterval(run, everyMs);
  // A pending purge must not keep the process alive after the app closes.
  timer.unref();
  return () => clearInterval(timer);
}
