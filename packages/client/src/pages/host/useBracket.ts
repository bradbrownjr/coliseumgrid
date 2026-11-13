import type { Bracket } from '@coliseumgrid/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { failureWords } from '../../api/errors.ts';
import { getBracket } from '../../api/bracket.ts';

export interface BracketState {
  /** undefined until the first answer; null when no bracket has been made. */
  bracket: Bracket | null | undefined;
  /** Words for a failed load, or null. */
  loadWords: string | null;
  /** Asks the server for the bracket again. */
  reload: () => Promise<void>;
  /** Takes the bracket from the answer of a write, which is newer than any load still in flight. */
  apply: (bracket: Bracket | null) => void;
}

/**
 * The host screen's bracket. A load that was sent before a write's answer arrived is dropped
 * when it comes back, so a slow GET can't put an older bracket over the one a result just
 * produced.
 */
export function useBracket(): BracketState {
  const [bracket, setBracket] = useState<Bracket | null | undefined>(undefined);
  const [loadWords, setLoadWords] = useState<string | null>(null);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    const result = await getBracket();
    if (mine !== latest.current) return;
    if (result.ok) {
      setBracket(result.data.bracket);
      setLoadWords(null);
    } else {
      setLoadWords(failureWords(result));
    }
  }, []);

  const apply = useCallback((next: Bracket | null) => {
    latest.current += 1;
    setBracket(next);
    setLoadWords(null);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { bracket, loadWords, reload, apply };
}
