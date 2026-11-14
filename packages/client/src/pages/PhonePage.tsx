import { parseJoinCode } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ERROR_WORDS, FOLLOW_CODE_WORDS, failureWords, guessWords } from '../api/errors.ts';
import { followWithCode } from '../api/phone.ts';
import { FollowFlow } from './phone/FollowFlow.tsx';
import { PlayerView } from './phone/PlayerView.tsx';
import { usePhone } from './phone/usePhone.ts';

/** The words for a follow code that didn't work. A limit means waiting, like the join screen. */
const codeWords = (failure: Parameters<typeof failureWords>[0]): string =>
  failure.error === 'too-many-tries' ? guessWords(failure) : failureWords(failure, FOLLOW_CODE_WORDS);

/**
 * The player page at `/follow` (docs/PLAN.md, "Player view"). A phone that follows nobody
 * signs in with a handle and PIN. A code in the address (`?code=`, from the QR code on the
 * Sign-up done screen) is used at once and removed from the address, like the join screen.
 * Nothing here needs the host: the phone signs itself in.
 */
export function PhonePage() {
  const [params, setParams] = useSearchParams();
  const phone = usePhone();
  const [notice, setNotice] = useState<string | null>(null);
  // A code works once, so the effect must not run twice (React's dev double-run).
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const code = params.get('code');
      if (code !== null) {
        // Used or refused either way; don't leave it in the address to be used again on a reload.
        setParams({}, { replace: true });
        // A code that can't be read would only use up a guess (the server counts it as wrong).
        if (parseJoinCode(code) === null) {
          setNotice(ERROR_WORDS['wrong-code']);
        } else {
          const result = await followWithCode(code);
          if (!result.ok) setNotice(codeWords(result));
        }
      }
      await phone.reload();
    })();
    // Runs once per visit; the hook's functions and the router's change every render.
  }, []);

  if (phone.state.phase === 'ready') {
    return (
      <PlayerView
        answer={phone.state.answer}
        failed={phone.state.failed}
        reload={phone.reload}
        onSignedOut={phone.signedOut}
        notice={notice}
        onClearNotice={() => setNotice(null)}
      />
    );
  }

  if (phone.state.phase === 'signed-out') {
    return <FollowFlow title="Follow your matches" notice={notice} onFollowed={() => void phone.reload()} />;
  }

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, p: 2, textAlign: 'center' }}>
      {phone.state.failed ? (
        <Typography variant="h5" role="status">
          Can&apos;t reach the host. Trying again.
        </Typography>
      ) : (
        <CircularProgress aria-label="Loading your matches" />
      )}
    </Box>
  );
}
