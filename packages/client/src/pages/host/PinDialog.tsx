import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { PinDigits } from '../../components/PinDigits.tsx';

interface PinDialogProps {
  title: string;
  pin: string;
  onClose: () => void;
}

/** A new PIN, shown once: the server keeps only a hash, so closing this is the last look. */
export function PinDialog({ title, pin, onClose }: PinDialogProps) {
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
        <PinDigits pin={pin} />
        <DialogContentText>Tell the player this PIN. It won&apos;t show again.</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
