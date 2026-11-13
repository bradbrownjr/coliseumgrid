import type { HostSessionAnswer } from '@coliseumgrid/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { useCallback, useEffect, useState } from 'react';
import { failureWords } from '../api/errors.ts';
import { getHostSession } from '../api/host.ts';
import { onNotSignedIn } from '../api/request.ts';
import { HostScreen } from './host/HostScreen.tsx';
import { SetupPanel, SignInPanel } from './host/HostSignIn.tsx';

type Gate = { name: 'loading' } | { name: 'failed'; words: string } | { name: 'setup' } | { name: 'sign-in' } | { name: 'in' };

function gateFor(session: HostSessionAnswer): Gate {
  if (session.signedIn) return { name: 'in' };
  return session.canSetUp ? { name: 'setup' } : { name: 'sign-in' };
}

/**
 * /host asks the server who this is before it shows anything (docs/PLAN.md, "Host sign-in"):
 * a first-run password panel, a sign-in panel, or the host screen. Any call answered 401
 * not-signed-in comes back here, so an expired session lands on the sign-in panel.
 */
export function HostPage() {
  const [gate, setGate] = useState<Gate>({ name: 'loading' });

  /** Asks again and returns whether the host is now signed in. */
  const refresh = useCallback(async (): Promise<boolean> => {
    const result = await getHostSession();
    if (!result.ok) {
      setGate({ name: 'failed', words: failureWords(result) });
      return false;
    }
    setGate(gateFor(result.data));
    return result.data.signedIn;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => onNotSignedIn(() => void refresh()), [refresh]);

  switch (gate.name) {
    case 'loading':
      return (
        <Box sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress aria-label="Loading" />
        </Box>
      );
    case 'failed':
      return (
        <Box sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
          <Alert
            severity="error"
            action={
              <Button color="inherit" onClick={() => void refresh()}>
                Try again
              </Button>
            }
          >
            {gate.words}
          </Alert>
        </Box>
      );
    case 'setup':
      return <SetupPanel onDone={refresh} />;
    case 'sign-in':
      return <SignInPanel onDone={refresh} />;
    case 'in':
      return <HostScreen onSignedOut={() => void refresh()} />;
  }
}
