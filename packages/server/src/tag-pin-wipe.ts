// Wiping plain PINs that waited in the print queue for TAG_PIN_MAX_MS (tag-queue.ts): once at
// startup and once an hour after that (docs/PLAN.md, "The print queue"). The tags stay queued
// and print with no PIN. Hourly, so a PIN outlives its 12 hours by an hour at most.

import { TAG_PIN_MAX_MS, type TagQueue } from './tag-queue.ts';

export const TAG_PIN_WIPE_EVERY_MS = 60 * 60 * 1000;

/**
 * Wipes now, then every `everyMs`. `onWiped` runs when a PIN was wiped, so host screens reload
 * the queue. A failed wipe is logged and tried again the next hour. Returns a function that stops
 * the schedule.
 */
export function startTagPinWipe(
  tags: Pick<TagQueue, 'wipeOldPins'>,
  onWiped: () => void,
  warn: (message: string) => void,
  everyMs: number = TAG_PIN_WIPE_EVERY_MS,
): () => void {
  const run = (): void => {
    try {
      if (tags.wipeOldPins(TAG_PIN_MAX_MS) > 0) onWiped();
    } catch (error) {
      warn(`Old PINs in the print queue could not be wiped: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  run();
  const timer = setInterval(run, everyMs);
  // A pending wipe must not keep the process alive after the app closes.
  timer.unref();
  return () => clearInterval(timer);
}
