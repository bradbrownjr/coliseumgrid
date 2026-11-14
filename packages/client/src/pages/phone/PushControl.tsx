import AddToHomeScreenIcon from '@mui/icons-material/AddToHomeScreen';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsIcon from '@mui/icons-material/Notifications';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { startState, turnOff, turnOn, type PushState } from './pushClient.ts';

interface PushViewProps {
  state: PushState;
  /** A turn on or off is in progress. */
  busy: boolean;
  /** Words about the last try, shown when it didn't work. */
  words: string | null;
  onTurnOn: () => void;
  onTurnOff: () => void;
}

/** A line with an icon: the sound row's "Sound is on." is the model. */
function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Typography variant="body1" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
      <Box component="span" sx={{ display: 'flex', pt: 0.25 }} aria-hidden>
        {icon}
      </Box>
      <span>{children}</span>
    </Typography>
  );
}

/**
 * What the control looks like in each state. It has no state of its own, so each look is
 * tested and photographed without a browser's push.
 */
export function PushView({ state, busy, words, onTurnOn, onTurnOff }: PushViewProps) {
  if (state === 'checking') return null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {state === 'off' && (
        <>
          <Button variant="outlined" size="large" startIcon={<NotificationsIcon />} disabled={busy} onClick={onTurnOn}>
            Turn on lock screen alerts
          </Button>
          <Typography variant="body1" color="text.secondary">
            Get an alert even when this page is closed.
          </Typography>
        </>
      )}
      {state === 'on' && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Line icon={<NotificationsActiveIcon />}>Lock screen alerts are on.</Line>
          <Button variant="outlined" color="secondary" size="large" disabled={busy} onClick={onTurnOff}>
            Turn off
          </Button>
        </Box>
      )}
      {state === 'blocked' && <Line icon={<NotificationsOffIcon />}>Your browser blocked alerts. Turn them on in its settings.</Line>}
      {state === 'unsupported' && <Line icon={<NotificationsOffIcon />}>This browser can&apos;t show lock screen alerts.</Line>}
      {state === 'ios-install' && (
        <Line icon={<AddToHomeScreenIcon />}>
          On iPhone, lock screen alerts need the Home Screen. Tap Share, then Add to Home Screen, and sign in again there.
        </Line>
      )}
      {words && <Alert severity="error">{words}</Alert>}
    </Box>
  );
}

/**
 * The lock screen alerts control (docs/PLAN.md, "Player view", "Push"). Given only when the
 * server sent a push key (PushSlot), so it never shows offline or over plain HTTP.
 */
export function PushControl({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<PushState>('checking');
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void startState(publicKey).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  const run = async (action: () => Promise<{ state: PushState; words: string | null }>) => {
    setBusy(true);
    setWords(null);
    const outcome = await action();
    setBusy(false);
    setState(outcome.state);
    setWords(outcome.words);
  };

  // `turnOn` is called in the click itself, so the browser sees the permission question
  // asked from a tap.
  return <PushView state={state} busy={busy} words={words} onTurnOn={() => void run(() => turnOn(publicKey))} onTurnOff={() => void run(turnOff)} />;
}
