import type { DeviceRole } from '@coliseumgrid/core';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { reconnectDelay } from '../api/live.ts';
import { getHostSession, getMyDevice } from '../api/host.ts';
import { onNotSignedIn } from '../api/request.ts';

type Check = 'checking' | 'ok' | 'unreachable';

/** Where a screen without a valid pairing goes: the join screen is the plain address. */
export function useGoToJoin(): () => void {
  const navigate = useNavigate();
  return useCallback(() => navigate('/', { replace: true }), [navigate]);
}

/**
 * Shows `children` only to a device paired with `role`. The Sign-up screen also takes a host
 * session (docs/PLAN.md, "Host sign-in"). Anyone else goes to the join screen. If the server
 * can't be reached the check repeats, slowly, so a TV started before the laptop catches up on
 * its own. Once children show, a later 401 sends the screen to the join screen too.
 */
export function AccessGate({ role, children }: { role: DeviceRole; children: ReactNode }) {
  const [check, setCheck] = useState<Check>('checking');
  const goToJoin = useGoToJoin();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    async function run() {
      const me = await getMyDevice();
      if (cancelled) return;
      if (me.ok && me.data.device.role === role) return setCheck('ok');
      let unreachable = !me.ok && me.error === 'failed';
      if (role === 'signup' && !unreachable) {
        const session = await getHostSession();
        if (cancelled) return;
        if (session.ok && session.data.signedIn) return setCheck('ok');
        unreachable = !session.ok && session.error === 'failed';
      }
      if (!unreachable) return goToJoin();
      setCheck('unreachable');
      timer = setTimeout(() => void run(), reconnectDelay(failures++));
    }

    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [role, goToJoin]);

  useEffect(() => (check === 'ok' ? onNotSignedIn(goToJoin) : undefined), [check, goToJoin]);

  if (check === 'ok') return children;
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, p: 2, textAlign: 'center' }}>
      {check === 'checking' ? (
        <CircularProgress aria-label="Checking this screen" />
      ) : (
        <Typography variant="h5" role="status">
          Can&apos;t reach the host. Trying again.
        </Typography>
      )}
    </Box>
  );
}
