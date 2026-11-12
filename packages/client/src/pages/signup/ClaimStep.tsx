import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { failureWords } from '../../api/errors.ts';
import { claimHandle } from '../../api/players.ts';
import { PinDigits } from '../../components/PinDigits.tsx';
import { PinKeypad } from '../../components/PinKeypad.tsx';
import { usePinEntry } from '../../components/usePinEntry.ts';
import { ErrorSlot, SignupFrame, bigButtonSx, linkButtonSx } from './SignupFrame.tsx';

interface ClaimStepProps {
  handle: string;
  onDone: (handle: string, pin: string) => void;
  onPickAnother: () => void;
}

/** A taken handle: the player proves it is theirs with its PIN. */
export function ClaimStep({ handle, onDone, onPickAnother }: ClaimStepProps) {
  const entry = usePinEntry();
  const [words, setWords] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    if (busy || !entry.complete) return;
    setBusy(true);
    setWords(null);
    const result = await claimHandle(handle, entry.pin);
    setBusy(false);
    if (result.ok) return onDone(result.data.player.handle, entry.pin);
    setWords(failureWords(result));
    setLockedOut(result.error === 'too-many-tries');
    entry.reset('');
  };

  return (
    <SignupFrame narrow title="Enter your PIN">
      <Typography variant="h4" component="p" sx={{ overflowWrap: 'anywhere' }}>
        {handle}
      </Typography>
      <PinDigits pin={entry.pin} />
      <ErrorSlot words={words} reserve />
      <PinKeypad onDigit={entry.press} onBackspace={entry.backspace} disabled={busy || lockedOut} />
      <Button
        variant="contained"
        size="large"
        fullWidth
        onClick={signIn}
        disabled={!entry.complete || busy || lockedOut}
        sx={bigButtonSx}
      >
        Sign in
      </Button>
      <Button size="large" onClick={onPickAnother} sx={linkButtonSx}>
        Pick another handle
      </Button>
    </SignupFrame>
  );
}
