import { parseJoinCode } from '@coliseumgrid/core';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { useEffect, useRef, useState, type SubmitEventHandler } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ERROR_WORDS, guessWords } from '../api/errors.ts';
import { getMyDevice, joinWithCode } from '../api/host.ts';
import { EntryFrame, bigButtonSx } from '../components/EntryFrame.tsx';
import { useStepGuard } from '../components/useStepGuard.ts';
import { tidyCodeInput } from '../pairing.ts';

/** Where a paired device belongs. */
const HOME = { display: '/display', signup: '/signup' } as const;

/**
 * The plain address (docs/PLAN.md, "Pairing a device"): a TV or tablet types one code and
 * becomes a Display or a Sign-up screen. A device that is already paired goes straight to its
 * screen. A code in the address (`?code=`, from the QR code) is used at once.
 */
export function JoinPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const stillHere = useStepGuard();
  const urlCode = params.get('code');

  const [value, setValue] = useState(urlCode === null ? '' : tidyCodeInput(urlCode));
  const [words, setWords] = useState<string | null>(null);
  // Starts busy when there is something to do before the form can show.
  const [busy, setBusy] = useState(true);
  const [showForm, setShowForm] = useState(false);
  // A code works once, so the effect below must not run twice (React's dev double-run).
  const started = useRef(false);

  const join = async (typed: string): Promise<boolean> => {
    // A code that can't be read would only use up a guess (the server counts it as wrong).
    if (parseJoinCode(typed) === null) {
      setWords(ERROR_WORDS['wrong-code']);
      return false;
    }
    setBusy(true);
    const result = await joinWithCode(typed);
    if (!stillHere()) return true;
    if (result.ok) {
      navigate(HOME[result.data.device.role], { replace: true });
      return true;
    }
    setBusy(false);
    setWords(guessWords(result));
    return false;
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      if (urlCode !== null) {
        // The code has been used or refused either way; don't leave it in the address to be
        // used again on a reload.
        setParams({}, { replace: true });
        if (!(await join(urlCode)) && stillHere()) setShowForm(true);
        return;
      }
      const me = await getMyDevice();
      if (!stillHere()) return;
      if (me.ok) return navigate(HOME[me.data.device.role], { replace: true });
      setBusy(false);
      setShowForm(true);
    })();
    // Runs once per visit; `join` and the router functions change every render.
  }, []);

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!busy) void join(value);
  };

  if (!showForm) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress aria-label="Checking this screen" />
      </Box>
    );
  }

  return (
    <EntryFrame title="Enter the code">
      <Box component="form" onSubmit={submit} noValidate sx={{ display: 'contents' }}>
        <TextField
          autoFocus
          fullWidth
          label="Code"
          value={value}
          error={words !== null}
          helperText={words ?? "It's on the host's screen."}
          onChange={(event) => {
            setValue(tidyCodeInput(event.target.value));
            setWords(null);
          }}
          autoComplete="off"
          slotProps={{
            htmlInput: {
              // A real text input, so a TV's on-screen keyboard and a remote's arrow keys work.
              // The dash is added as they type; capitals are made for them.
              autoCapitalize: 'characters',
              autoCorrect: 'off',
              spellCheck: false,
              sx: { typography: 'h2', textAlign: 'center', letterSpacing: '0.1em', py: 3, height: 'auto' },
            },
            formHelperText: { sx: { typography: 'h6', textAlign: 'center', mx: 0 } },
          }}
        />
        <Button type="submit" variant="contained" size="large" fullWidth disabled={value === '' || busy} sx={bigButtonSx}>
          Join
        </Button>
      </Box>
    </EntryFrame>
  );
}
