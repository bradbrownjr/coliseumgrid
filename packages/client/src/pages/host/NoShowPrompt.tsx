import CheckIcon from '@mui/icons-material/Check';
import HourglassBottomIcon from '@mui/icons-material/HourglassBottom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { STILL_WAITING, THEY_ARE_HERE } from '../../noShow.ts';

interface NoShowPromptProps {
  busy: boolean;
  /** **They're here**: ends the wait for this call, and the TV's call line with it. */
  onHere: () => void;
  /** **Forfeit**: asks who is missing. */
  onForfeit: () => void;
}

/**
 * A station card's prompt once the wait for a missing player is over (docs/PLAN.md, "Waiting
 * for a missing player"). Nothing happens by itself. **They're here** puts the prompt away for
 * this call; **Forfeit** asks who is missing.
 */
export function NoShowPrompt({ busy, onHere, onForfeit }: NoShowPromptProps) {
  return (
    <Alert severity="warning" icon={<HourglassBottomIcon />} sx={{ alignItems: 'center', '.MuiAlert-message': { flex: 1, minWidth: 0 } }}>
      <Stack sx={{ gap: 1 }}>
        <Typography sx={{ fontWeight: 'bold' }}>{STILL_WAITING}</Typography>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button color="inherit" variant="outlined" startIcon={<CheckIcon />} disabled={busy} onClick={onHere}>
            {THEY_ARE_HERE}
          </Button>
          <Button color="inherit" variant="outlined" disabled={busy} onClick={onForfeit}>
            Forfeit
          </Button>
        </Stack>
      </Stack>
    </Alert>
  );
}
