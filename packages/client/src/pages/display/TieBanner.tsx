import type { TieNotice } from '@coliseumgrid/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import { scaleType, tieMessage } from './model.ts';

/** One line per tie for places 1 to 3 that still has to be played off (docs/PLAN.md, "Ties"). */
export function TieBanner({ ties }: { ties: TieNotice[] }) {
  if (ties.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {ties.map((tie) => (
        <Alert key={tie.place} severity="warning" variant="outlined" sx={{ typography: scaleType('h4'), lineHeight: 1.25, alignItems: 'center', '& .MuiAlert-icon': { fontSize: '1.4em' } }}>
          {tieMessage(tie)}
        </Alert>
      ))}
    </Box>
  );
}
