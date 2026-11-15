import type { BestOf, BracketMatch, BracketStation } from '@coliseumgrid/core';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import TimerIcon from '@mui/icons-material/Timer';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { waitIsOver } from '../../noShow.ts';
import { elapsedText, matchTitle } from './bracketWords.ts';
import { NoShowPrompt } from './NoShowPrompt.tsx';

interface StationGridProps {
  stations: BracketStation[];
  bestOf: BestOf;
  now: number;
  busy: boolean;
  /** Minutes after the call before the card asks "Still waiting?". */
  noShowMinutes: number;
  onWinner: (matchId: number, winnerId: number, winnerHandle: string) => void;
  onForfeit: (match: BracketMatch) => void;
}

/** One card per station, laid out in columns from the md breakpoint up. */
export function StationGrid({ stations, ...card }: StationGridProps) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' } }}>
      {stations.map((station) => (
        <StationCard key={station.number} station={station} {...card} />
      ))}
    </Box>
  );
}

interface StationCardProps extends Omit<StationGridProps, 'stations'> {
  station: BracketStation;
}

/**
 * A station's match with a big "<handle> won" button for each player. A tap records the winner
 * of the whole match, whatever the best-of label says (docs/PLAN.md, "1 vs 1 bracket"). The
 * timer counts up from the time the match was called.
 */
function StationCard({ station, bestOf, now, busy, noShowMinutes, onWinner, onForfeit }: StationCardProps) {
  const { match } = station;
  const elapsed = elapsedText(station.calledAt, now);
  const waited = match !== null && match.slots.every((slot) => slot.player) && waitIsOver(station.calledAt, noShowMinutes, now);
  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="h6" component="h3">
          Station {station.number}
        </Typography>
        {match && elapsed && (
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
            <TimerIcon fontSize="small" aria-hidden />
            <Typography role="timer" aria-label="Time on this station" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {elapsed}
            </Typography>
          </Stack>
        )}
      </Stack>
      {match ? (
        <>
          <Typography variant="body2" color="text.secondary">
            {matchTitle(match)}, best of {bestOf}
          </Typography>
          {match.slots.map((slot, index) =>
            slot.player ? (
              <Button
                key={slot.player.id}
                variant="contained"
                size="large"
                disabled={busy}
                startIcon={<EmojiEventsIcon />}
                onClick={() => slot.player && onWinner(match.id, slot.player.id, slot.player.handle)}
                sx={(theme) => ({ minHeight: theme.spacing(9), typography: 'h6', overflowWrap: 'anywhere', textAlign: 'start' })}
              >
                {slot.player.handle} won
              </Button>
            ) : (
              <Typography key={index}>To be decided</Typography>
            ),
          )}
          {waited && <NoShowPrompt busy={busy} onForfeit={() => onForfeit(match)} />}
        </>
      ) : (
        <Typography color="text.secondary">Waiting for a match.</Typography>
      )}
    </Paper>
  );
}
