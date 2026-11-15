import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { PlayerLine } from './PlayerLine.tsx';
import { elapsedText, stationCallLine, type StationCard, type TypeVariant } from './model.ts';
import { useNow } from '../../components/useNow.ts';

interface StationsPanelProps {
  stations: StationCard[];
  layout: { columns: 1 | 2; variant: TypeVariant };
  /** Shown on a station with nothing on it. */
  idle: string;
  /** The group's name goes on its own line under "Station n", which a narrow card needs. */
  noteBelow?: boolean;
  /** Minutes after the call before the card calls its players again. */
  noShowMinutes: number;
}

/** One card per station: the handles (two in a match, up to four in a group) and a timer counting up from the call. */
export function StationsPanel({ stations, layout, idle, noteBelow = false, noShowMinutes }: StationsPanelProps) {
  const now = useNow(true);

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
        const call = stationCallLine(station, noShowMinutes, now);
        return (
          <Box
            key={station.number}
            sx={{
              border: 2,
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: 'background.paper',
              px: { xs: 2, md: 1.5, xl: 2 },
              py: { xs: 1.5, md: 1, xl: 1.5 },
              minWidth: 0,
              typography: layout.variant,
              lineHeight: 1.25,
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
              <Typography component="h2" sx={{ fontSize: '0.8em', lineHeight: 1.25, color: 'text.secondary' }}>
                Station {station.number}
                {station.note && !noteBelow && `: ${station.note}`}
              </Typography>
              {station.slots.length > 0 && timer !== null && (
                <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                  {timer}
                </Box>
              )}
            </Box>
            {noteBelow && station.note && (
              <Box sx={{ fontWeight: 700, color: 'text.primary', mb: 0.25 }}>{station.note}</Box>
            )}
            {station.slots.length > 0 ? (
              station.slots.map((slot, index) => <PlayerLine key={index} slot={slot} />)
            ) : (
              <Box sx={{ fontSize: '0.8em', color: 'text.secondary' }}>{idle}</Box>
            )}
            {/* Large, and in words: the crimson fill is never the only sign. */}
            {call && (
              <Box
                role="status"
                sx={{
                  mt: 0.75,
                  px: 1,
                  py: 0.5,
                  borderRadius: 1,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  fontWeight: 700,
                  overflowWrap: 'anywhere',
                }}
              >
                {call}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
