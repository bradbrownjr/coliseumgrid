import { useEffect, useState } from 'react';
import { serverNow } from '../api/clock.ts';

/**
 * The server's time in milliseconds (`serverNow`), refreshed every second while `active`, for
 * the count-up timers and the no-show wait on the host and the Display, which count from the
 * server's `calledAt`.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!active) return;
    setNow(serverNow());
    const timer = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
