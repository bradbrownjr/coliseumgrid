import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect } from 'react';
import { PinDigits } from '../../components/PinDigits.tsx';
import { QrCode } from '../../components/QrCode.tsx';
import { EntryFrame, bigButtonSx } from '../../components/EntryFrame.tsx';

/** How long the done screen stays before the line moves on by itself. */
export const DONE_SECONDS = 15;

/** With a QR code the screen stays longer, so a kid has time to scan it (Brad, 2026-11-14; docs/PLAN.md, "Player view"). */
export const DONE_QR_SECONDS = 30;

interface DoneStepProps {
  handle: string;
  /** Only a new sign-up has one to show. A returning player typed theirs and doesn't see it again. */
  pin?: string;
  /** What the QR code opens on a phone, or null or left off when there is none to show (see `followUrl`). */
  followUrl?: string | null;
  onNext: () => void;
}

export function DoneStep({ handle, pin, followUrl = null, onNext }: DoneStepProps) {
  const seconds = followUrl === null ? DONE_SECONDS : DONE_QR_SECONDS;

  // Back to the handle screen by itself, so a player who walks away doesn't hold the line.
  useEffect(() => {
    const timer = setTimeout(onNext, seconds * 1000);
    return () => clearTimeout(timer);
  }, [onNext, seconds]);

  return (
    // With the QR code the logo goes (`narrow`), so the code and the button fit a 1024 by 768 tablet.
    <EntryFrame narrow={followUrl !== null} title={`You're in, ${handle}!`}>
      {pin !== undefined && (
        <>
          <Typography variant="h5" component="p">
            Your PIN
          </Typography>
          <PinDigits pin={pin} />
        </>
      )}
      {followUrl !== null && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, width: '100%' }}>
          <QrCode text={followUrl} label="QR code that opens the player page on your phone" />
          <Typography variant="h6" component="p">
            Scan with your phone to follow your matches
          </Typography>
        </Box>
      )}
      <Button variant="contained" size="large" fullWidth onClick={onNext} sx={bigButtonSx}>
        Next player
      </Button>
    </EntryFrame>
  );
}
