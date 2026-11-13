import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect } from 'react';
import { PinDigits } from '../../components/PinDigits.tsx';
import { EntryFrame, bigButtonSx } from '../../components/EntryFrame.tsx';

/** How long the done screen stays before the line moves on by itself. */
export const DONE_SECONDS = 15;

interface DoneStepProps {
  handle: string;
  /** Only a new sign-up has one to show. A returning player typed theirs and doesn't see it again. */
  pin?: string;
  onNext: () => void;
}

export function DoneStep({ handle, pin, onNext }: DoneStepProps) {
  // Back to the handle screen by itself, so a player who walks away doesn't hold the line.
  useEffect(() => {
    const timer = setTimeout(onNext, DONE_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [onNext]);

  return (
    <EntryFrame title={`You're in, ${handle}!`}>
      {pin !== undefined && (
        <>
          <Typography variant="h5" component="p">
            Your PIN
          </Typography>
          <PinDigits pin={pin} />
        </>
      )}
      <Button variant="contained" size="large" fullWidth onClick={onNext} sx={bigButtonSx}>
        Next player
      </Button>
    </EntryFrame>
  );
}
