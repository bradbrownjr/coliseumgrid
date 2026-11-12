import { HANDLE_MAX, HANDLE_MIN, checkHandle } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { useState, type SubmitEventHandler } from 'react';
import { failureWords, HANDLE_REFUSAL_WORDS } from '../../api/errors.ts';
import { checkSignup } from '../../api/players.ts';
import { SignupFrame, bigButtonSx } from './SignupFrame.tsx';

interface HandleStepProps {
  onAvailable: (handle: string, suggestedPin: string) => void;
  onTaken: (handle: string) => void;
}

export function HandleStep({ onAvailable, onTaken }: HandleStepProps) {
  const [value, setValue] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [serverWords, setServerWords] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Quick feedback from the shared rules. "Too short" waits for Next, because every handle
  // is too short after the first letter. The server still decides (CLAUDE.md, rule 2).
  const check = checkHandle(value);
  const liveWords =
    value !== '' && !check.ok && (check.reason !== 'too-short' || attempted)
      ? HANDLE_REFUSAL_WORDS[check.reason]
      : null;
  const words = liveWords ?? serverWords;

  const submit: SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!check.ok) {
      setAttempted(true);
      return;
    }
    setBusy(true);
    const result = await checkSignup(check.handle);
    setBusy(false);
    if (!result.ok) {
      setServerWords(failureWords(result));
      return;
    }
    if (result.data.status === 'taken') onTaken(result.data.handle);
    else onAvailable(result.data.handle, result.data.suggestedPin);
  };

  return (
    <SignupFrame title="Pick your handle">
      <Box component="form" onSubmit={submit} noValidate sx={{ display: 'contents' }}>
        <TextField
          autoFocus
          fullWidth
          label="Handle"
          value={value}
          error={words !== null}
          helperText={words ?? `Use ${HANDLE_MIN} to ${HANDLE_MAX} letters or numbers.`}
          onChange={(event) => {
            setValue(event.target.value);
            setServerWords(null);
          }}
          autoComplete="off"
          spellCheck={false}
          slotProps={{
            htmlInput: { autoCorrect: 'off', sx: { typography: 'h4', textAlign: 'center', py: 3, height: 'auto' } },
            formHelperText: { sx: { typography: 'h6', textAlign: 'center', mx: 0 } },
          }}
        />
        <Button type="submit" variant="contained" size="large" fullWidth disabled={value.trim() === '' || busy} sx={bigButtonSx}>
          Next
        </Button>
      </Box>
    </SignupFrame>
  );
}
