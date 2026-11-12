import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { failureWords } from '../../api/errors.ts';
import { signUp } from '../../api/players.ts';
import { PinDigits } from '../../components/PinDigits.tsx';
import { PinKeypad } from '../../components/PinKeypad.tsx';
import { usePinEntry } from '../../components/usePinEntry.ts';
import { ErrorSlot, SignupFrame, bigButtonSx, linkButtonSx } from './SignupFrame.tsx';

interface PinStepProps {
  handle: string;
  suggestedPin: string;
  onDone: (handle: string, pin: string) => void;
  onTaken: (handle: string) => void;
  onPickAnother: () => void;
}

/** The suggested PIN is already in place. Keep takes it; the keypad changes it (never required). */
export function PinStep({ handle, suggestedPin, onDone, onTaken, onPickAnother }: PinStepProps) {
  const entry = usePinEntry(suggestedPin, true);
  const [words, setWords] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const keep = async () => {
    if (busy || !entry.complete) return;
    setBusy(true);
    setWords(null);
    const result = await signUp(handle, entry.pin);
    setBusy(false);
    if (result.ok) return onDone(result.data.player.handle, entry.pin);
    // Someone signed up with this handle while this player was choosing a PIN.
    if (result.error === 'taken') return onTaken(handle);
    setWords(failureWords(result));
  };

  return (
    <SignupFrame narrow title="Your PIN">
      <Typography variant="h5" component="p">
        Remember your PIN. You use it to sign in again.
      </Typography>
      <PinDigits pin={entry.pin} />
      <ErrorSlot words={words} />
      <Typography variant="h5" component="p" color="text.secondary">
        Want a different one? Tap the numbers.
      </Typography>
      <PinKeypad onDigit={entry.press} onBackspace={entry.backspace} disabled={busy} />
      {entry.pin !== suggestedPin && (
        <Button size="large" onClick={() => entry.reset(suggestedPin)} disabled={busy} sx={linkButtonSx}>
          Go back to {suggestedPin}
        </Button>
      )}
      <Button variant="contained" size="large" fullWidth onClick={keep} disabled={!entry.complete || busy} sx={bigButtonSx}>
        Keep
      </Button>
      <Button size="large" onClick={onPickAnother} sx={linkButtonSx} disabled={busy}>
        Pick another handle
      </Button>
    </SignupFrame>
  );
}
