import { PIN_LENGTH } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface PinDigitsProps {
  pin: string;
}

/**
 * The PIN in big boxes, one digit each, so a kid can read it and remember it. The boxes share
 * the width they have and stop growing at the theme's largest size, so they fit a phone dialog
 * and stay big on a tablet or the TV (docs/DESIGN.md, "Phone width").
 */
export function PinDigits({ pin }: PinDigitsProps) {
  const spoken = pin ? pin.split('').join(' ') : 'empty';
  return (
    <Box
      role="img"
      aria-label={`PIN ${spoken}`}
      sx={{ display: 'flex', gap: { xs: 1, sm: 2 }, justifyContent: 'center', width: '100%' }}
    >
      {Array.from({ length: PIN_LENGTH }, (_unused, index) => (
        <Box
          key={index}
          aria-hidden
          sx={{
            flex: '1 1 0',
            minWidth: 0,
            maxWidth: (theme) => theme.spacing(10),
            aspectRatio: '5 / 6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 2,
            borderColor: 'text.secondary',
            borderRadius: 2,
            bgcolor: 'background.paper',
          }}
        >
          <Typography variant="h2" component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {pin[index] ?? ''}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
