import type { Player } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { scaleType } from './model.ts';

/**
 * The players, before any group has a result. Everyone is level then, so places and a cut line
 * would be noise; the standings table takes over once the first group is recorded.
 */
export function PlayersList({ players }: { players: Player[] }) {
  return (
    <Box component="section" aria-label="Players" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0 }}>
      <Typography sx={{ typography: scaleType('h5'), color: 'text.secondary', lineHeight: 1.25 }}>
        Places start after the first group.
      </Typography>
      <Box
        component="ul"
        sx={{
          m: 0,
          p: 0,
          listStyle: 'none',
          display: 'grid',
          // em, so the columns follow the type size and 32 players fit on one screen.
          gridTemplateColumns: 'repeat(auto-fill, minmax(9em, 1fr))',
          columnGap: 3,
          rowGap: 0.75,
          typography: scaleType('h4'),
          lineHeight: 1.25,
          fontWeight: 700,
        }}
      >
        {players.map((player) => (
          <Box component="li" key={player.id} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {player.handle}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
