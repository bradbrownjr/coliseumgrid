import type { BracketFormat, BracketMatch } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import { PlayerLine, type LineState } from './PlayerLine.tsx';
import { FORFEIT_MARK } from '../../noShow.ts';
import { loserWords, type Density } from './model.ts';

interface MatchCardProps {
  match: BracketMatch;
  format: BracketFormat;
  /** True when the bracket has a rematch for the title, which changes what a first-final loss means. */
  hasRematch: boolean;
  /** The station the match is on, when it is being played. */
  station: number | undefined;
  density: Density;
}

/** One match in the bracket: both handles, and who won. Nothing here takes input. */
export function MatchCard({ match, format, hasRematch, station, density }: MatchCardProps) {
  const done = match.status === 'done' && match.winner !== null;
  const lineState = (index: 0 | 1): LineState => (!done ? 'open' : match.winner === index ? 'winner' : 'loser');
  const outWords = loserWords(format, match, hasRematch);
  const playing = match.status === 'playing';

  const note = (index: 0 | 1) => (lineState(index) === 'loser' ? { note: outWords } : {});

  return (
    <Box
      sx={{
        border: 2,
        borderRadius: 1,
        borderColor: playing ? 'primary.light' : 'divider',
        bgcolor: 'background.paper',
        px: density.compact ? 1.5 : 2,
        py: density.tight ? 0 : density.compact ? 0.25 : 1,
        minWidth: 0,
        display: 'flex',
        alignItems: density.compact ? 'center' : 'flex-start',
        gap: 1,
        typography: density.variant,
        lineHeight: 1.25,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {match.status === 'bye' ? (
          <PlayerLine slot={match.slots.find((slot) => !slot.bye) ?? match.slots[0]} note="Moves on this round" />
        ) : density.compact ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: '0.5em' }}>
            <PlayerLine slot={match.slots[0]} state={lineState(0)} {...note(0)} />
            <Box component="span" sx={{ fontSize: '0.7em', color: 'text.secondary' }}>
              vs
            </Box>
            <PlayerLine slot={match.slots[1]} state={lineState(1)} {...note(1)} />
          </Box>
        ) : (
          <>
            <PlayerLine slot={match.slots[0]} state={lineState(0)} {...note(0)} />
            <PlayerLine slot={match.slots[1]} state={lineState(1)} {...note(1)} />
          </>
        )}
      </Box>
      {done && match.forfeit && (
        <Box component="span" sx={{ fontSize: '0.6em', color: 'text.secondary', whiteSpace: 'nowrap' }}>
          {FORFEIT_MARK}
        </Box>
      )}
      {playing && station !== undefined && (
        <Box component="span" sx={{ fontSize: '0.6em', color: 'text.secondary', whiteSpace: 'nowrap' }}>
          Station {station}
        </Box>
      )}
    </Box>
  );
}
