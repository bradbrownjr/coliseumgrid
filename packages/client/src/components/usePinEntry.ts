import { PIN_LENGTH } from '@coliseumgrid/core';
import { useCallback, useState } from 'react';

/**
 * The PIN being typed on the keypad. With `replaceFirst`, the first tap replaces the whole
 * starting value (the suggested PIN) instead of adding to it, so changing a PIN is one tap
 * per digit and keeping it takes no taps.
 */
export function usePinEntry(initial = '', replaceFirst = false) {
  const [pin, setPin] = useState(initial);
  const [fresh, setFresh] = useState(replaceFirst);

  const press = useCallback(
    (digit: string) => {
      setPin((current) => ((fresh ? '' : current) + digit).slice(0, PIN_LENGTH));
      setFresh(false);
    },
    [fresh],
  );

  const backspace = useCallback(() => {
    setPin((current) => (fresh ? '' : current.slice(0, -1)));
    setFresh(false);
  }, [fresh]);

  /** Puts a PIN back, and makes the next tap replace it again if that is how this started. */
  const reset = useCallback(
    (value: string) => {
      setPin(value);
      setFresh(replaceFirst);
    },
    [replaceFirst],
  );

  return { pin, press, backspace, reset, complete: pin.length === PIN_LENGTH };
}
