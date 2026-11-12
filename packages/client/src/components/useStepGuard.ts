import { useCallback, useEffect, useRef } from 'react';

/**
 * Returns a function that is true while the step is on screen. A step awaits the server and
 * then moves on or shows an answer; if the player left the step meanwhile (Pick another
 * handle, the done screen's timer), a late answer would act on the next player's screen.
 * Check it after every await.
 */
export function useStepGuard(): () => boolean {
  const current = useRef(true);
  // Set on every mount, not just created true: React's dev double-run of effects unmounts once.
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);
  return useCallback(() => current.current, []);
}
