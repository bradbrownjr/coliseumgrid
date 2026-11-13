import type { BracketStation } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { PlayerLine } from './PlayerLine.tsx';
import { elapsedText, stationLayout } from './model.ts';
import { useScreen } from './useScreen.ts';
import { useNow } from '../../components/useNow.ts';

/** One card per station: the two handles and a timer counting up from the call. */
export function StationsPanel({ stations }: { stations: BracketStation[] }) {
  const now = useNow(true);
  const layout = stationLayout(stations.length, useScreen());

  return (
    <Box
      component="section"
      aria-label="Stations"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: `repeat(${layout.columns}, minmax(0, 1fr))` },
        gap: 1.5,
        alignContent: 'start',
      }}
    >
      {stations.map((station) => {
        const timer = elapsedText(station.calledAt, now);
        return (
          <Box
            key={station.number}
            sx={{
              border: 2,
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: 'background.paper',
              px: { xs: 2, xl: 2 },
              py: { xs: 1.5, md: 1, xl: 1.5 },
              minWidth: 0,
              typography: layout.variant,
              lineHeight: 1.25,
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
              <Typography component="h2" sx={{ fontSize: '0.8em', lineHeight: 1.25, color: 'text.secondary' }}>
                Station {station.number}
                {station.match?.side === 'tie-break' && ': tie-break'}
              </Typography>
              {station.match && timer !== null && (
                <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                  {timer}
                </Box>
              )}
            </Box>
            {station.match ? (
              <>
                <PlayerLine slot={station.match.slots[0]} />
                <PlayerLine slot={station.match.slots[1]} />
              </>
            ) : (
              <Box sx={{ fontSize: '0.8em', color: 'text.secondary' }}>Waiting for a match</Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
