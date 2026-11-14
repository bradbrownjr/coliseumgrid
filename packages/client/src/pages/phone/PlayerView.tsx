import { PHONE_FOLLOWS_MAX, type FollowedPlayer, type PhoneAnswer } from '@coliseumgrid/core';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { ERROR_WORDS, failureWords } from '../../api/errors.ts';
import { signOutPhone, stopFollowing } from '../../api/phone.ts';
import { ColorModePicker } from '../../components/ColorModePicker.tsx';
import { Logo } from '../../components/Logo.tsx';
import { useLive } from '../../components/useLive.ts';
import { CALL_VIBRATION } from './alerts.ts';
import { CalledOverlay } from './CalledOverlay.tsx';
import { FollowFlow } from './FollowFlow.tsx';
import { NextBanner } from './NextBanner.tsx';
import { PhoneStandings } from './PhoneStandings.tsx';
import { baseTitle } from './phoneWords.ts';
import { PlayerCard } from './PlayerCard.tsx';
import { PushSlot, usePushKey } from './PushSlot.tsx';
import { useAlertSound } from './useAlertSound.ts';
import { useAlerts } from './useAlerts.ts';
import { usePageTitle } from './usePageTitle.ts';
import { useWakeLock } from './useWakeLock.ts';

interface PlayerViewProps {
  answer: PhoneAnswer;
  /** The last reload didn't work, so what shows may be out of date. */
  failed: boolean;
  reload: () => Promise<void>;
  /** This phone follows nobody now: back to the sign-in. */
  onSignedOut: () => void;
  /** Words from opening the page with a code that didn't work. */
  notice: string | null;
  onClearNotice: () => void;
}

/**
 * The player page (docs/PLAN.md, "Player view"): a card for each followed player, the
 * standings, and the alerts. It reloads GET /api/phone on every live message. A phone that
 * is unpaired (signed out, or left following nobody) goes back to the sign-in.
 */
export function PlayerView({ answer, failed, reload, onSignedOut, notice, onClearNotice }: PlayerViewProps) {
  const sound = useAlertSound();
  const pushKey = usePushKey();
  const [adding, setAdding] = useState(false);
  const [stopping, setStopping] = useState<FollowedPlayer | null>(null);
  const [words, setWords] = useState<string | null>(null);

  useLive({
    onMessage: () => void reload(),
    // A message sent while the socket was down is lost, so each connect reads again.
    onOpen: () => void reload(),
    onEnded: onSignedOut,
  });
  useWakeLock();

  const alerts = useAlerts(answer.following, {
    onCalled: () => {
      sound.play();
      // Not on iPhone (https://caniuse.com/vibration), and a browser may want a tap first.
      navigator.vibrate?.([...CALL_VIBRATION]);
    },
  });
  usePageTitle(alerts.calls, alerts.soon, baseTitle(answer.event?.name));

  const followedIds = useMemo(() => new Set(answer.following.map((f) => f.player.id)), [answer.following]);

  const stop = async (player: FollowedPlayer) => {
    setStopping(null);
    const result = await stopFollowing(player.player.id);
    if (result.ok) return void reload();
    setWords(failureWords(result));
  };

  const signOut = async () => {
    const result = await signOutPhone();
    if (result.ok) return onSignedOut();
    setWords(failureWords(result));
  };

  const full = answer.following.length >= PHONE_FOLLOWS_MAX;

  return (
    <>
      <CalledOverlay calls={alerts.calls} onDismiss={alerts.dismissCalls} />
      {adding ? (
        <FollowFlow
          title="Follow another player"
          onFollowed={() => {
            setAdding(false);
            void reload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Container component="main" maxWidth="sm" sx={{ py: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <NextBanner alerts={alerts.soon} onDismiss={alerts.dismissSoon} />
          <Box component="header" sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Logo size={5} />
            <Typography variant="h5" component="h1" sx={{ flex: 1, minWidth: 0, fontWeight: 700, overflowWrap: 'anywhere', lineHeight: 1.2 }}>
              {answer.event?.name ?? 'ColiseumGrid'}
            </Typography>
          </Box>

          {notice && (
            <Alert severity="error" onClose={onClearNotice}>
              {notice}
            </Alert>
          )}
          {failed && <Alert severity="warning">Can&apos;t reach the host. Trying again.</Alert>}
          {words && (
            <Alert severity="error" onClose={() => setWords(null)}>
              {words}
            </Alert>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {/* The row keeps its height when the sound turns on. The first tap anywhere does that, and a row that shrank would move what the finger is on before it lifts, so the tap would be lost. */}
            <Box sx={{ minHeight: (theme) => theme.spacing(7), display: 'flex', alignItems: 'center' }}>
              {sound.on ? (
                <Typography variant="body1" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <VolumeUpIcon aria-hidden /> Sound is on.
                </Typography>
              ) : (
                <Button variant="contained" size="large" fullWidth startIcon={<VolumeOffIcon />} onClick={sound.unlock} sx={{ minHeight: (theme) => theme.spacing(7) }}>
                  Tap to turn on sound
                </Button>
              )}
            </Box>
            <Typography variant="body1" color="text.secondary">
              Alerts work best with this page open.
            </Typography>
          </Box>

          {answer.following.map((followed) => (
            <PlayerCard key={followed.player.id} followed={followed} standings={answer.standings} onStop={() => setStopping(followed)} />
          ))}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Button variant="outlined" size="large" startIcon={<PersonAddIcon />} disabled={full} onClick={() => setAdding(true)}>
              Follow another player
            </Button>
            {full && (
              <Typography variant="body1" color="text.secondary">
                {ERROR_WORDS['too-many-handles']}
              </Typography>
            )}
          </Box>

          {answer.standings && <PhoneStandings standings={answer.standings} followedIds={followedIds} />}

          <PushSlot publicKey={pushKey} />

          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2, pt: 1 }}>
            <Button variant="outlined" color="secondary" size="large" onClick={() => void signOut()}>
              Sign out
            </Button>
            <ColorModePicker />
          </Box>
        </Container>
      )}

      <Dialog open={stopping !== null} onClose={() => setStopping(null)} aria-labelledby="stop-title">
        <DialogTitle id="stop-title">Stop following {stopping?.player.handle}?</DialogTitle>
        <DialogContent>
          <DialogContentText>You need their PIN to follow again.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStopping(null)}>Keep following</Button>
          <Button variant="contained" onClick={() => stopping && void stop(stopping)}>
            Stop following
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
