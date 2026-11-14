import type { FollowedPlayer } from '@coliseumgrid/core';
import { useEffect, useRef, useState } from 'react';
import { decideAlerts, mergeAlerts, stillCalled, stillNext, type AlertMemory, type CalledAlert, type NextAlert } from './alerts.ts';

interface UseAlertsOptions {
  /** Runs once for each answer that brings a new call, to play the sound and buzz. */
  onCalled: (calls: CalledAlert[]) => void;
}

/**
 * The alerts a followed player's status calls for, between one answer and the next. A call
 * stays until the player taps "On my way", or until the status moves on (a result recorded or
 * undone); a "next" banner stays while the player is still first in Up next.
 */
export function useAlerts(following: readonly FollowedPlayer[], { onCalled }: UseAlertsOptions) {
  const memory = useRef<AlertMemory | null>(null);
  const onCalledRef = useRef(onCalled);
  useEffect(() => {
    onCalledRef.current = onCalled;
  });

  const [calls, setCalls] = useState<CalledAlert[]>([]);
  const [soon, setSoon] = useState<NextAlert[]>([]);

  useEffect(() => {
    const decision = decideAlerts(memory.current, following);
    memory.current = decision.memory;
    if (decision.called.length > 0) {
      setCalls((current) => mergeAlerts(current, decision.called));
      onCalledRef.current(decision.called);
    }
    if (decision.next.length > 0) setSoon((current) => mergeAlerts(current, decision.next));
  }, [following]);

  return {
    calls: stillCalled(calls, following),
    soon: stillNext(soon, following),
    dismissCalls: () => setCalls([]),
    dismissSoon: (playerId: number) => setSoon((current) => current.filter((a) => a.playerId !== playerId)),
  };
}
