import { useCallback, useEffect, useRef, useState } from 'react';
import { failureWords } from '../../api/errors.ts';
import type { Result } from '../../api/request.ts';

export interface Snapshot<T> {
  /** undefined until the first answer; null when nothing has been made. */
  value: T | null | undefined;
  /** Words for a failed load, or null. */
  loadWords: string | null;
  /** Asks the server again. */
  reload: () => Promise<void>;
  /** Takes the value from the answer of a write, which is newer than any load still in flight. */
  apply: (value: T | null) => void;
}

/**
 * One thing the server sends whole each time (the bracket, the groups). A load that was sent
 * before a write's answer arrived is dropped when it comes back, so a slow GET can't put an
 * older copy over the one a result just produced. `load` has to be the same function on every
 * render.
 */
export function useSnapshot<T>(load: () => Promise<Result<T | null>>): Snapshot<T> {
  const [value, setValue] = useState<T | null | undefined>(undefined);
  const [loadWords, setLoadWords] = useState<string | null>(null);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    const result = await load();
    if (mine !== latest.current) return;
    if (result.ok) {
      setValue(result.data);
      setLoadWords(null);
    } else {
      setLoadWords(failureWords(result));
    }
  }, [load]);

  const apply = useCallback((next: T | null) => {
    latest.current += 1;
    setValue(next);
    setLoadWords(null);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { value, loadWords, reload, apply };
}
