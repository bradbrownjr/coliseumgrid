import type { TieNotice } from '@coliseumgrid/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import { scaleType, tieMessage } from './model.ts';

/** One line per tie that still has to be played off (docs/PLAN.md, "Ties"). `message` words it; groups word it as a race. */
export function TieBanner({ ties, message = tieMessage }: { ties: TieNotice[]; message?: (tie: TieNotice) => string }) {
  if (ties.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {ties.map((tie) => (
        <Alert key={tie.place} severity="warning" variant="outlined" sx={{ typography: scaleType('h4'), lineHeight: 1.25, alignItems: 'center', '& .MuiAlert-icon': { fontSize: '1.4em' } }}>
          {message(tie)}
        </Alert>
      ))}
    </Box>
  );
}
