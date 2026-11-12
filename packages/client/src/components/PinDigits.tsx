import { PIN_LENGTH } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface PinDigitsProps {
  pin: string;
}

/** The PIN in big boxes, one digit each, so a kid can read it and remember it. */
export function PinDigits({ pin }: PinDigitsProps) {
  const spoken = pin ? pin.split('').join(' ') : 'empty';
  return (
    <Box role="img" aria-label={`PIN ${spoken}`} sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
      {Array.from({ length: PIN_LENGTH }, (_unused, index) => (
        <Box
          key={index}
          aria-hidden
          sx={{
            width: (theme) => theme.spacing(10),
            height: (theme) => theme.spacing(12),
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
