import type { PhoneAnswer } from '@coliseumgrid/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { reconnectDelay } from '../../api/live.ts';
import { getPhone } from '../../api/phone.ts';

export type PhoneState =
  /** Nothing has come back yet. `failed` is true while the server can't be reached. */
  | { phase: 'loading'; failed: boolean }
  /** This phone follows nobody: show the sign-in. */
  | { phase: 'signed-out' }
  /** `failed` is true while a reload didn't work, so `answer` may be out of date. */
  | { phase: 'ready'; answer: PhoneAnswer; failed: boolean };

/**
 * The phone's one answer, GET /api/phone (docs/PLAN.md, "Phone API"). `reload` asks again; a
 * request sent before a newer one finished is dropped when it comes back, so a slow answer
 * can't put an older copy over a newer one. If the server can't be reached, the last answer
 * stays on screen and the load repeats, slowly, until it works.
 */
export function usePhone() {
  const [state, setState] = useState<PhoneState>({ phase: 'loading', failed: false });
  const latest = useRef(0);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gone = useRef(false);

  const reload = useCallback(async () => {
    clearTimeout(timer.current);
    const mine = ++latest.current;
    const result = await getPhone();
    if (mine !== latest.current || gone.current) return;
    if (result.ok) {
      failures.current = 0;
      setState({ phase: 'ready', answer: result.data, failed: false });
    } else if (result.error === 'not-following' || result.error === 'not-signed-in') {
      setState({ phase: 'signed-out' });
    } else {
      setState((current) => (current.phase === 'ready' ? { ...current, failed: true } : { phase: 'loading', failed: true }));
      timer.current = setTimeout(() => void reload(), reconnectDelay(failures.current++));
    }
  }, []);

  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      clearTimeout(timer.current);
    };
  }, []);

  /** This phone signed out or was cut off. Any request still in flight is ignored. */
  const signedOut = useCallback(() => {
    latest.current += 1;
    clearTimeout(timer.current);
    setState({ phase: 'signed-out' });
  }, []);

  return { state, reload, signedOut };
}
