import { HOST_PASSWORD_MAX, HOST_PASSWORD_MIN } from '@coliseumgrid/core';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type SubmitEventHandler } from 'react';
import { ERROR_WORDS, guessWords } from '../../api/errors.ts';
import { setUpHost, signInHost } from '../../api/host.ts';
import type { Result } from '../../api/request.ts';
import { EntryFrame, bigButtonSx } from '../../components/EntryFrame.tsx';
import { useStepGuard } from '../../components/useStepGuard.ts';

interface PasswordPanelProps {
  title: string;
  intro: string;
  label: string;
  submitLabel: string;
  /** Shown under the field until there is an error. */
  hint?: string;
  /** Setup checks the length before it asks; sign-in leaves that to the server. */
  minLength?: number;
  autoComplete: 'new-password' | 'current-password';
  send: (password: string) => Promise<Result<void>>;
  /** Called when the server accepted the password. Resolves to whether the host is now signed in. */
  onDone: () => Promise<boolean>;
}

/** One password field on a centered panel, for both first-run setup and sign-in. */
function PasswordPanel({ title, intro, label, submitLabel, hint, minLength = 1, autoComplete, send, onDone }: PasswordPanelProps) {
  const [value, setValue] = useState('');
  const [shown, setShown] = useState(false);
  const [words, setWords] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stillHere = useStepGuard();

  const submit: SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (value.length < minLength) {
      setWords(hint ?? null);
      return;
    }
    setBusy(true);
    const result = await send(value);
    if (!stillHere()) return;
    if (!result.ok) {
      setBusy(false);
      setWords(guessWords(result));
      return;
    }
    const signedIn = await onDone();
    if (!stillHere()) return;
    setBusy(false);
    // The password was right but the session didn't stick (cookies blocked, say).
    if (!signedIn) setWords(ERROR_WORDS.failed);
  };

  return (
    <EntryFrame title={title}>
      <Typography variant="h6" component="p">
        {intro}
      </Typography>
      <Box component="form" onSubmit={submit} noValidate sx={{ display: 'contents' }}>
        <TextField
          autoFocus
          fullWidth
          label={label}
          type={shown ? 'text' : 'password'}
          value={value}
          error={words !== null}
          helperText={words ?? hint}
          autoComplete={autoComplete}
          onChange={(event) => {
            setValue(event.target.value);
            setWords(null);
          }}
          slotProps={{
            htmlInput: { maxLength: HOST_PASSWORD_MAX, autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false },
            formHelperText: { sx: { typography: 'body1', textAlign: 'center', mx: 0 } },
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton aria-label={shown ? 'Hide password' : 'Show password'} edge="end" onClick={() => setShown((was) => !was)}>
                    {shown ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        <Button type="submit" variant="contained" size="large" fullWidth disabled={value === '' || busy} sx={bigButtonSx}>
          {submitLabel}
        </Button>
      </Box>
    </EntryFrame>
  );
}

interface PanelProps {
  onDone: () => Promise<boolean>;
}

/** The first visit on the laptop, with no password yet (the server's `canSetUp`). */
export function SetupPanel({ onDone }: PanelProps) {
  return (
    <PasswordPanel
      title="Choose a host password"
      intro="You type it on other devices to run the event."
      label="New password"
      submitLabel="Save password"
      hint={`Use ${HOST_PASSWORD_MIN} to ${HOST_PASSWORD_MAX} characters.`}
      minLength={HOST_PASSWORD_MIN}
      autoComplete="new-password"
      send={setUpHost}
      onDone={onDone}
    />
  );
}

export function SignInPanel({ onDone }: PanelProps) {
  return (
    <PasswordPanel
      title="Host sign-in"
      intro="Type the host password."
      label="Host password"
      submitLabel="Sign in"
      autoComplete="current-password"
      send={signInHost}
      onDone={onDone}
    />
  );
}
