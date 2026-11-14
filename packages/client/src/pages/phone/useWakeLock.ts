import { useEffect } from 'react';

/**
 * Keeps the screen on while the page is in front, so a phone doesn't lock before the player's
 * call. The browser drops the lock when the page is hidden, so it is asked for again when the
 * page comes back (https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).
 * Only secure contexts (HTTPS) have it; elsewhere, or when the browser refuses (a low battery,
 * for one), this does nothing and says nothing.
 */
export function useWakeLock(): void {
  useEffect(() => {
    if (!window.isSecureContext || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let stopped = false;

    const request = async () => {
      if (stopped || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (stopped) return void lock.release().catch(() => undefined);
        sentinel = lock;
      } catch {
        // Refused: the screen may lock. The page works without it.
      }
    };

    const onVisible = () => void request();
    document.addEventListener('visibilitychange', onVisible);
    void request();
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);
}
