import BackspaceIcon from '@mui/icons-material/Backspace';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { SxProps, Theme } from '@mui/material/styles';

interface PinKeypadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  disabled?: boolean;
}

const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
] as const;

const keySx: SxProps<Theme> = (theme) => ({
  // Shorter on a phone so the keypad and the buttons under it fit a short screen; still over 44px.
  height: theme.spacing(8),
  [theme.breakpoints.up('sm')]: { height: theme.spacing(10) },
  typography: 'h3',
  // The outline stays visible in dark mode, where the secondary color is light.
  borderWidth: 2,
  '&:hover': { borderWidth: 2 },
});

/** 0 to 9 and backspace, sized for a thumb on a tablet (docs/DESIGN.md, "Kid-sized targets"). */
export function PinKeypad({ onDigit, onBackspace, disabled = false }: PinKeypadProps) {
  const digitKey = (digit: string) => (
    <Button key={digit} variant="outlined" color="secondary" disabled={disabled} onClick={() => onDigit(digit)} sx={keySx}>
      {digit}
    </Button>
  );

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: { xs: 1, sm: 2 },
        width: '100%',
        maxWidth: (theme) => theme.spacing(48),
      }}
    >
      {ROWS.flat().map(digitKey)}
      <Box />
      {digitKey('0')}
      <Button
        variant="outlined"
        color="secondary"
        disabled={disabled}
        aria-label="Delete last number"
        onClick={onBackspace}
        sx={keySx}
      >
        <BackspaceIcon fontSize="large" />
      </Button>
    </Box>
  );
}
