import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type SubmitEventHandler } from 'react';
import { FOLLOW_PIN_WORDS, guessWords } from '../../api/errors.ts';
import { followPlayer } from '../../api/phone.ts';
import { ErrorSlot, EntryFrame, bigButtonSx, linkButtonSx } from '../../components/EntryFrame.tsx';
import { PinDigits } from '../../components/PinDigits.tsx';
import { PinKeypad } from '../../components/PinKeypad.tsx';
import { usePinEntry } from '../../components/usePinEntry.ts';
import { useStepGuard } from '../../components/useStepGuard.ts';

interface FollowFlowProps {
  /** The first sign-in and "Follow another player" use the same two steps. */
  title: string;
  /** Words from an earlier try (a code that didn't work), shown on the handle step. */
  notice?: string | null;
  /** The phone follows the player now: load the page again. */
  onFollowed: () => void;
  /** Only when the phone already follows someone: a way back to the page. */
  onCancel?: () => void;
}

/**
 * Handle, then PIN: the same two steps as the Sign-up claim (docs/DESIGN.md, "Sign-up"), each
 * a centered entry panel. The server checks both together and answers the same for a wrong PIN
 * and a handle that isn't there, so the words name both and the flow stays on the PIN step.
 */
export function FollowFlow({ title, notice = null, onFollowed, onCancel }: FollowFlowProps) {
  const [handle, setHandle] = useState('');
  const [step, setStep] = useState<'handle' | 'pin'>('handle');
  const [words, setWords] = useState<string | null>(notice);
  const [lockedOut, setLockedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const entry = usePinEntry();
  const stillHere = useStepGuard();

  const toPin: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (handle.trim() === '') return;
    setWords(null);
    setStep('pin');
  };

  const follow = async () => {
    if (busy || !entry.complete) return;
    setBusy(true);
    setWords(null);
    const result = await followPlayer(handle.trim(), entry.pin);
    if (!stillHere()) return;
    setBusy(false);
    if (result.ok) return onFollowed();
    entry.reset('');
    setWords(guessWords(result, FOLLOW_PIN_WORDS));
    setLockedOut(result.error === 'too-many-tries');
  };

  if (step === 'handle') {
    return (
      <EntryFrame title={title}>
        <Box component="form" onSubmit={toPin} noValidate sx={{ display: 'contents' }}>
          <Typography variant="h6" component="p">
            Type your handle. Then your PIN.
          </Typography>
          {words !== null && <ErrorSlot words={words} />}
          <TextField
            autoFocus
            fullWidth
            label="Handle"
            value={handle}
            onChange={(event) => {
              setHandle(event.target.value);
              setWords(null);
            }}
            autoComplete="off"
            spellCheck={false}
            slotProps={{
              htmlInput: { autoCapitalize: 'off', autoCorrect: 'off', sx: { typography: 'h4', textAlign: 'center', py: 3, height: 'auto' } },
            }}
          />
          <Button type="submit" variant="contained" size="large" fullWidth disabled={handle.trim() === ''} sx={bigButtonSx}>
            Next
          </Button>
          {onCancel && (
            <Button size="large" onClick={onCancel} sx={linkButtonSx}>
              Back
            </Button>
          )}
        </Box>
      </EntryFrame>
    );
  }

  return (
    <EntryFrame narrow title="Enter your PIN">
      <Typography variant="h4" component="p" sx={{ overflowWrap: 'anywhere' }}>
        {handle.trim()}
      </Typography>
      <PinDigits pin={entry.pin} />
      <ErrorSlot words={words} reserve />
      <PinKeypad onDigit={entry.press} onBackspace={entry.backspace} disabled={busy || lockedOut} />
      <Button variant="contained" size="large" fullWidth onClick={() => void follow()} disabled={!entry.complete || busy || lockedOut} sx={bigButtonSx}>
        Follow
      </Button>
      <Button
        size="large"
        onClick={() => {
          setWords(null);
          setLockedOut(false);
          entry.reset('');
          setStep('handle');
        }}
        disabled={busy}
        sx={linkButtonSx}
      >
        Pick another handle
      </Button>
    </EntryFrame>
  );
}
