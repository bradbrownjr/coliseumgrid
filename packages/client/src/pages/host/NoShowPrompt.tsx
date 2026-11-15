import HourglassBottomIcon from '@mui/icons-material/HourglassBottom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { STILL_WAITING } from '../../noShow.ts';

/**
 * A station card's prompt once the wait for a missing player is over (docs/PLAN.md, "Waiting
 * for a missing player"). Nothing happens by itself; **Forfeit** asks who is missing.
 */
export function NoShowPrompt({ busy, onForfeit }: { busy: boolean; onForfeit: () => void }) {
  return (
    <Alert severity="warning" icon={<HourglassBottomIcon />} sx={{ alignItems: 'center', '.MuiAlert-message': { flex: 1, minWidth: 0 } }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 'bold' }}>{STILL_WAITING}</Typography>
        <Button color="inherit" variant="outlined" disabled={busy} onClick={onForfeit}>
          Forfeit
        </Button>
      </Stack>
    </Alert>
  );
}
