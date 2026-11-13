import type { BracketSlot } from '@coliseumgrid/core';
import TrophyIcon from '@mui/icons-material/EmojiEvents';
import Box from '@mui/material/Box';

export type LineState = 'open' | 'winner' | 'loser';

interface PlayerLineProps {
  slot: BracketSlot;
  state?: LineState;
  /** "Out", "One life left", or "Moves on this round", after the handle. */
  note?: string;
}

/**
 * One player on a card. A winner is gold with a trophy; a loser is gray with a word. Color is
 * never the only signal (docs/DESIGN.md). The size comes from the parent's type, in em.
 */
export function PlayerLine({ slot, state = 'open', note }: PlayerLineProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        columnGap: '0.4em',
        minWidth: 0,
        fontWeight: state === 'winner' ? 700 : 400,
        color: state === 'winner' ? 'win.main' : state === 'loser' ? 'loss.main' : 'text.primary',
      }}
    >
      {state === 'winner' && (
        <TrophyIcon titleAccess="Winner" sx={{ fontSize: '1em', alignSelf: 'center', flexShrink: 0 }} />
      )}
      <Box component="span" sx={{ overflowWrap: 'anywhere', color: slot.player ? 'inherit' : 'text.secondary' }}>
        {slot.player?.handle ?? 'Waiting'}
      </Box>
      {note && (
        <Box component="span" sx={{ fontSize: '0.7em', fontWeight: 400, color: state === 'loser' ? 'loss.main' : 'text.secondary' }}>
          {note}
        </Box>
      )}
    </Box>
  );
}
