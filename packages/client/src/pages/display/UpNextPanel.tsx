import type { BracketMatch } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { UP_NEXT_COUNT, scaleType, upNextType } from './model.ts';
import { useScreen } from './useScreen.ts';

/** The next matches in the queue, in the Up next color (docs/DESIGN.md, "Colors"). */
export function UpNextPanel({ matches }: { matches: BracketMatch[] }) {
  const next = matches.slice(0, UP_NEXT_COUNT);
  const listType = upNextType(useScreen());
  return (
    <Box
      component="section"
      sx={{ border: 2, borderColor: 'upNext.main', borderRadius: 1, px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Typography component="h2" sx={{ typography: scaleType('h5'), color: 'upNext.main', lineHeight: 1.25 }}>
        Up next
      </Typography>
      {next.length === 0 ? (
        <Typography sx={{ typography: listType, color: 'text.secondary' }}>No matches waiting.</Typography>
      ) : (
        <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1, typography: listType, lineHeight: 1.25 }}>
          {next.map((match) => (
            <Box component="li" key={match.id} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: '0.5em' }}>
              {match.side === 'tie-break' && (
                <Box component="span" sx={{ fontSize: '0.7em', color: 'text.secondary' }}>
                  Tie-break:
                </Box>
              )}
              <Box component="span" sx={{ overflowWrap: 'anywhere' }}>
                {match.slots[0].player?.handle ?? 'Waiting'}
              </Box>
              <Box component="span" sx={{ fontSize: '0.7em', color: 'text.secondary' }}>
                vs
              </Box>
              <Box component="span" sx={{ overflowWrap: 'anywhere' }}>
                {match.slots[1].player?.handle ?? 'Waiting'}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
