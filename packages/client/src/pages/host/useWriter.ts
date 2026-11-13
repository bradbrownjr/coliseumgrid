import { useRef, useState } from 'react';
import { failureWords } from '../../api/errors.ts';
import type { Result } from '../../api/request.ts';

/** Shows a message in the host screen's snackbar, with an Undo button when `undo` is given. */
export type Say = (message: string, undo?: () => void) => void;

/**
 * Runs the host's writes to the bracket or the groups, one at a time. A refusal is read out and
 * the screen's copy is loaded again, since it was out of date. The ref stops a second tap in the
 * same instant; `busy` disables the buttons.
 */
export function useWriter<A>(apply: (answer: A) => void, reload: () => Promise<void>, say: Say) {
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  const run = async <T>(call: () => Promise<Result<T>>, answerOf: (data: T) => A, done: (data: T) => void) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const result = await call();
    working.current = false;
    setBusy(false);
    if (result.ok) {
      apply(answerOf(result.data));
      done(result.data);
    } else {
      say(failureWords(result));
      void reload();
    }
  };

  return { busy, run };
}
