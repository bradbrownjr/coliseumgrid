import { formatJoinCode, type DeviceRole, type PairingCodeAnswer } from '@coliseumgrid/core';
import TabletIcon from '@mui/icons-material/TabletMac';
import TvIcon from '@mui/icons-material/Tv';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useNow } from '../../components/useNow.ts';
import { failureWords } from '../../api/errors.ts';
import { makePairingCode } from '../../api/host.ts';
import { formatCountdown, isLoopbackHost, joinUrl, shownAddress } from '../../pairing.ts';
import { QrCode } from '../../components/QrCode.tsx';

const ROLE_WORDS: Record<DeviceRole, string> = { display: 'a TV', signup: 'a sign-up tablet' };

/**
 * Makes pairing codes and shows the latest one: the address to open, the code, a QR code that
 * holds both, and the time left. A new code replaces the one on screen; the older code still
 * works until it runs out, because the server keeps several live at once.
 */
export function PairingPanel() {
  const [code, setCode] = useState<PairingCodeAnswer | null>(null);
  const [making, setMaking] = useState<DeviceRole | null>(null);
  const [words, setWords] = useState<string | null>(null);
  // From the page's own address. On the laptop itself that is localhost, which no other screen
  // can reach, so the host types the laptop's network address instead (see below).
  const [address, setAddress] = useState(window.location.origin);
  const now = useNow(code !== null);

  const make = async (role: DeviceRole) => {
    setMaking(role);
    const result = await makePairingCode(role);
    setMaking(null);
    if (!result.ok) return setWords(failureWords(result));
    setWords(null);
    setCode(result.data);
  };

  const loopback = isLoopbackHost(window.location.hostname);
  const url = code && joinUrl(address, code.code);
  const left = code ? Date.parse(code.expiresAt) - now : 0;
  const expired = code !== null && left <= 0;

  return (
    <Stack sx={{ gap: 2 }}>
      <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap' }}>
        <Button variant="contained" size="large" startIcon={<TvIcon />} disabled={making !== null} onClick={() => void make('display')}>
          Add a TV
        </Button>
        <Button variant="contained" size="large" startIcon={<TabletIcon />} disabled={making !== null} onClick={() => void make('signup')}>
          Add a sign-up tablet
        </Button>
      </Stack>

      {words && <Alert severity="error">{words}</Alert>}

      {code && (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 2, sm: 4 }, alignItems: { xs: 'center', sm: 'flex-start' } }}>
          {url && !expired && <QrCode text={url} label={`QR code that opens ${shownAddress(address)} with the code ${formatJoinCode(code.code)}`} />}
          <Stack sx={{ gap: 1, minWidth: 0, width: '100%' }}>
            <Typography variant="h6" component="h3">
              Code for {ROLE_WORDS[code.role]}
            </Typography>
            {loopback && (
              <Alert severity="warning">
                This page is open on the laptop, and other screens can&apos;t reach &quot;localhost&quot;. Type the laptop&apos;s network address here, like http://192.168.1.20:3000.
              </Alert>
            )}
            {loopback && (
              <TextField
                label="Address for other screens"
                value={address}
                error={url === null}
                helperText={url === null ? "That doesn't look like an address." : undefined}
                onChange={(event) => setAddress(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            )}
            <Typography variant="body1">1. Open this address</Typography>
            <Typography variant="h4" component="p" sx={{ overflowWrap: 'anywhere' }}>
              {shownAddress(address)}
            </Typography>
            <Typography variant="body1">2. Type this code, or scan the QR code</Typography>
            <Typography variant="h2" component="p" sx={{ letterSpacing: '0.1em', fontVariantNumeric: 'tabular-nums' }}>
              {formatJoinCode(code.code)}
            </Typography>
            <Typography role="timer" color={expired ? 'error' : 'text.secondary'}>
              {expired ? 'This code ran out. Make a new one.' : `Runs out in ${formatCountdown(left)}`}
            </Typography>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
