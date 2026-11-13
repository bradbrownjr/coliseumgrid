import type { Heat, HeatStation } from '@coliseumgrid/core';
import EditNoteIcon from '@mui/icons-material/EditNote';
import TimerIcon from '@mui/icons-material/Timer';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { elapsedText } from './bracketWords.ts';
import { heatTitle } from './groupWords.ts';

interface GroupStationsProps {
  stations: HeatStation[];
  /** Every heat made so far, to number the tie-break races. */
  heats: readonly Heat[];
  now: number;
  busy: boolean;
  onRecord: (heat: Heat) => void;
}

/** One card per station, laid out in columns from the md breakpoint up. */
export function GroupStations({ stations, heats, now, busy, onRecord }: GroupStationsProps) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' } }}>
      {stations.map((station) => (
        <StationCard key={station.number} station={station} heats={heats} now={now} busy={busy} onRecord={onRecord} />
      ))}
    </Box>
  );
}

interface StationCardProps extends Omit<GroupStationsProps, 'stations'> {
  station: HeatStation;
}

/**
 * A station's group: its players, a count-up timer from the time it was called, and one "Record
 * result" button (docs/PLAN.md, "Races and free-for-all": recording is once per group).
 */
function StationCard({ station, heats, now, busy, onRecord }: StationCardProps) {
  const { heat } = station;
  const elapsed = elapsedText(station.calledAt, now);
  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="h6" component="h3">
          Station {station.number}
        </Typography>
        {heat && elapsed && (
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
            <TimerIcon fontSize="small" aria-hidden />
            <Typography role="timer" aria-label="Time on this station" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {elapsed}
            </Typography>
          </Stack>
        )}
      </Stack>
      {heat ? (
        <>
          <Typography variant="body2" color="text.secondary">
            {heatTitle(heat, heats)}
          </Typography>
          <Stack component="ul" sx={{ gap: 0.5, m: 0, p: 0, listStyle: 'none' }}>
            {heat.players.map((player) => (
              <Typography key={player.id} component="li" variant="h6" sx={{ overflowWrap: 'anywhere' }}>
                {player.handle}
              </Typography>
            ))}
          </Stack>
          <Button
            variant="contained"
            size="large"
            disabled={busy}
            startIcon={<EditNoteIcon />}
            onClick={() => onRecord(heat)}
            sx={(theme) => ({ minHeight: theme.spacing(9), typography: 'h6' })}
          >
            Record result
          </Button>
        </>
      ) : (
        <Typography color="text.secondary">Waiting for a group.</Typography>
      )}
    </Paper>
  );
}
