import { useRef, useState } from 'react';
import { failureWords, type WordOverrides } from '../../api/errors.ts';
import type { Result } from '../../api/request.ts';

/** What the host sees when a tap comes while the last change is still on its way. */
export const STILL_SAVING = 'Still saving the last change. Try again in a moment.';

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

  /** True while a write is on its way, so a caller can keep its own screen open instead of losing what was entered. */
  const isWorking = () => working.current;

  /**
   * `words` replace the standard words for a refusal of this one call. A second write while one
   * is on its way is not sent, and the host is told, so nothing is dropped without a word.
   */
  const run = async <T>(call: () => Promise<Result<T>>, answerOf: (data: T) => A, done: (data: T) => void, words?: WordOverrides) => {
    if (working.current) {
      say(STILL_SAVING);
      return;
    }
    working.current = true;
    setBusy(true);
    const result = await call();
    working.current = false;
    setBusy(false);
    if (result.ok) {
      apply(answerOf(result.data));
      done(result.data);
    } else {
      say(failureWords(result, words));
      void reload();
    }
  };

  return { busy, run, isWorking };
}
