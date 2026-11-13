import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { failureWords } from '../../api/errors.ts';
import { claimHandle } from '../../api/players.ts';
import { PinDigits } from '../../components/PinDigits.tsx';
import { PinKeypad } from '../../components/PinKeypad.tsx';
import { usePinEntry } from '../../components/usePinEntry.ts';
import { useStepGuard } from '../../components/useStepGuard.ts';
import { ErrorSlot, EntryFrame, bigButtonSx, linkButtonSx } from '../../components/EntryFrame.tsx';

interface ClaimStepProps {
  handle: string;
  // No PIN: a returning player just typed it, and a shared tablet shouldn't show it again.
  onDone: (handle: string) => void;
  onPickAnother: () => void;
}

/** A taken handle: the player proves it is theirs with its PIN. */
export function ClaimStep({ handle, onDone, onPickAnother }: ClaimStepProps) {
  const entry = usePinEntry();
  const [words, setWords] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const stillHere = useStepGuard();

  const signIn = async () => {
    if (busy || !entry.complete) return;
    setBusy(true);
    setWords(null);
    const result = await claimHandle(handle, entry.pin);
    if (!stillHere()) return;
    setBusy(false);
    if (result.ok) return onDone(result.data.player.handle);
    setWords(failureWords(result));
    setLockedOut(result.error === 'too-many-tries');
    entry.reset('');
  };

  return (
    <EntryFrame narrow title="Enter your PIN">
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
      <Button size="large" onClick={onPickAnother} disabled={busy} sx={linkButtonSx}>
        Pick another handle
      </Button>
    </EntryFrame>
  );
}
