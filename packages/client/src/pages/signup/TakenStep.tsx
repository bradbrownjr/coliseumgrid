import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ERROR_WORDS } from '../../api/errors.ts';
import { SignupFrame, bigButtonSx } from './SignupFrame.tsx';

interface TakenStepProps {
  handle: string;
  onItsMe: () => void;
  onPickAnother: () => void;
}

export function TakenStep({ handle, onItsMe, onPickAnother }: TakenStepProps) {
  return (
    <SignupFrame title={ERROR_WORDS.taken}>
      <Typography variant="h4" component="p" sx={{ overflowWrap: 'anywhere' }}>
        {handle}
      </Typography>
      <Stack spacing={2} sx={{ width: '100%' }}>
        <Button variant="contained" size="large" fullWidth onClick={onItsMe} sx={bigButtonSx}>
          It&apos;s me
        </Button>
        <Button variant="outlined" size="large" fullWidth onClick={onPickAnother} sx={bigButtonSx}>
          Pick another handle
        </Button>
      </Stack>
    </SignupFrame>
  );
}
