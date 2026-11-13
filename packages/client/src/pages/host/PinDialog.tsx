import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import CircularProgress from '@mui/material/CircularProgress';
import { PinDigits } from '../../components/PinDigits.tsx';

interface PinDialogProps {
  title: string;
  /** null while the server is still making the PIN. */
  pin: string | null;
  /** Shown instead of the PIN when the server couldn't make one. */
  words?: string | null;
  onClose: () => void;
}

/**
 * A new PIN, shown once: the server keeps only a hash, so closing this is the last look. A reset
 * opens it before the answer arrives (pin null) so a slow phone connection still shows the host
 * something the moment they tap.
 */
export function PinDialog({ title, pin, words = null, onClose }: PinDialogProps) {
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
        {words ? (
          <DialogContentText>{words}</DialogContentText>
        ) : pin === null ? (
          <CircularProgress aria-label="Making a new PIN" />
        ) : (
          <>
            <PinDigits pin={pin} />
            <DialogContentText>Tell the player this PIN. It won&apos;t show again.</DialogContentText>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
