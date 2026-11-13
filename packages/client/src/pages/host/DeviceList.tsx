import type { Device, DeviceRole } from '@coliseumgrid/core';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { failureWords } from '../../api/errors.ts';
import { listDevices, unpairDevice } from '../../api/host.ts';
import { lastSeenWords } from '../../pairing.ts';

const ROLE_WORDS: Record<DeviceRole, string> = { display: 'TV', signup: 'Sign-up tablet' };

/**
 * How often the list reloads. The live connection has no message for a device joining
 * (docs/PLAN.md, "Live messages"), so the list asks; a TV that just paired shows within this.
 */
const REFRESH_MS = 5000;

/** The paired screens, with an Unpair button each. */
export function DeviceList({ onUnpaired }: { onUnpaired: (message: string) => void }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [loadWords, setLoadWords] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<Device | null>(null);
  const [now, setNow] = useState(Date.now);

  const load = useCallback(async () => {
    const result = await listDevices();
    setNow(Date.now());
    if (result.ok) {
      setDevices(result.data.devices);
      setLoadWords(null);
    } else {
      setLoadWords(failureWords(result));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <Stack sx={{ gap: 1 }}>
      <Typography variant="h6" component="h3">
        Paired screens
      </Typography>
      {loadWords && <Alert severity="error">{loadWords}</Alert>}
      {devices?.length === 0 && <Typography>No screens yet. Add a TV or a sign-up tablet.</Typography>}
      {devices && devices.length > 0 && (
        <List disablePadding>
          {devices.map((device) => (
            <ListItem
              key={device.id}
              divider
              disableGutters
              sx={{ gap: 2, justifyContent: 'space-between' }}
            >
              <ListItemText
                sx={{ flex: '1 1 auto', minWidth: 0 }}
                primary={device.label}
                secondary={`${ROLE_WORDS[device.role]}. Seen ${lastSeenWords(device.lastSeen, now)}.`}
                slotProps={{ primary: { sx: { typography: 'h6', overflowWrap: 'anywhere' } } }}
              />
              <Button variant="outlined" startIcon={<LinkOffIcon />} sx={{ flexShrink: 0 }} onClick={() => setLeaving(device)} aria-label={`Unpair ${device.label}`}>
                Unpair
              </Button>
            </ListItem>
          ))}
        </List>
      )}
      {leaving && (
        <UnpairDialog
          device={leaving}
          onClose={() => setLeaving(null)}
          onDone={() => {
            onUnpaired(`Unpaired ${leaving.label}`);
            setLeaving(null);
            void load();
          }}
        />
      )}
    </Stack>
  );
}

/**
 * Unpairing can't be undone: the server forgets the screen's token, so the same screen needs a
 * new code. That makes it one of the actions that asks first (docs/DESIGN.md, "Undo, not Are
 * you sure"), like Merge.
 */
function UnpairDialog({ device, onDone, onClose }: { device: Device; onDone: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState<string | null>(null);

  const unpair = async () => {
    if (busy) return;
    setBusy(true);
    const result = await unpairDevice(device.id);
    setBusy(false);
    // Already gone (not-found) is what the host wanted.
    if (result.ok || result.error === 'not-found') return onDone();
    setWords(failureWords(result));
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Unpair {device.label}?</DialogTitle>
      <DialogContent>
        <DialogContentText>It stops working until it gets a new code. This can&apos;t be undone.</DialogContentText>
        {words && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {words}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color="error" onClick={() => void unpair()} disabled={busy}>
          Unpair
        </Button>
      </DialogActions>
    </Dialog>
  );
}
