import { useEffect, useState } from 'react';

/** The current time in milliseconds, refreshed every second while `active`, for the count-up timers on the host and the Display. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
