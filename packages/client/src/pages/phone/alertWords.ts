// The two alert lines, with no imports. The page shows them (phoneWords.ts re-exports them)
// and the push service worker shows them in a notification, so a phone says the same thing
// in both places. The worker is built as its own file (vite.push-assets.ts), so what it
// imports has to stay this small.

/** "Zap, go to station 2!", the line on the full-screen alert and on a push notification. */
export function calledWords(handle: string, station: number | null): string {
  return station === null ? `${handle}, you're up!` : `${handle}, go to station ${station}!`;
}

/** "Zap, you're next!", the line on the banner and on a push notification. */
export const nextWords = (handle: string): string => `${handle}, you're next!`;
