import { alertLevel, type FollowedPlayer, type PhoneStandings } from '@coliseumgrid/core';
import HourglassIcon from '@mui/icons-material/HourglassTop';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import NotificationsIcon from '@mui/icons-material/NotificationsActive';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import ScheduleIcon from '@mui/icons-material/Schedule';
import GamesIcon from '@mui/icons-material/SportsEsports';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import TrophyIcon from '@mui/icons-material/EmojiEvents';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { ElementType } from 'react';
import { othersWords, statusWords } from './phoneWords.ts';

const ICONS: Record<FollowedPlayer['status'], ElementType> = {
  now: GamesIcon,
  next: NotificationsIcon,
  'two-away': ScheduleIcon,
  later: ScheduleIcon,
  waiting: HourglassIcon,
  out: ThumbUpIcon,
  done: TrophyIcon,
  'not-in': InfoIcon,
};

/**
 * How loud the status block is, from `alertLevel` in core so the card and the alerts agree:
 * called is a crimson block (with an outline, so dark mode isn't a fill alone), next a blue
 * block, two away a blue outline. A podium finish is gold. Every state has an icon and words
 * too: color is never the only signal (docs/DESIGN.md).
 */
function blockSx(followed: FollowedPlayer): { bgcolor?: string; color?: string; borderColor: string } {
  switch (alertLevel(followed)) {
    case 'called':
      return { bgcolor: 'primary.main', color: 'primary.contrastText', borderColor: 'primary.light' };
    case 'next':
      return { bgcolor: 'upNext.main', color: 'upNext.contrastText', borderColor: 'upNext.main' };
    case 'two-away':
      return { borderColor: 'upNext.main' };
    case 'none':
      if (followed.status === 'done' && followed.place !== null && followed.place <= 3) {
        return { bgcolor: 'win.main', color: 'win.contrastText', borderColor: 'win.main' };
      }
      return { borderColor: 'divider' };
  }
}

interface PlayerCardProps {
  followed: FollowedPlayer;
  standings: PhoneStandings | null;
  onStop: () => void;
}

/** One followed player: the handle, where they stand in words, who else is in the match, and a way to stop following. */
export function PlayerCard({ followed, standings, onStop }: PlayerCardProps) {
  const Icon = ICONS[followed.status];
  const others = othersWords(followed, standings);
  const headingId = `follow-${followed.player.id}`;

  return (
    <Paper component="section" aria-labelledby={headingId} variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography id={headingId} variant="h5" component="h2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
        {followed.player.handle}
      </Typography>
      <Box
        role="status"
        sx={[
          { display: 'flex', alignItems: 'center', gap: 1.5, p: 2, border: 2, borderRadius: 1, typography: 'h5', fontWeight: 700 },
          blockSx(followed),
        ]}
      >
        <Icon aria-hidden sx={{ fontSize: '1.5em', flexShrink: 0 }} />
        <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          {statusWords(followed, standings)}
        </Box>
      </Box>
      {others && (
        <Typography variant="h6" component="p" sx={{ overflowWrap: 'anywhere' }}>
          {others}
        </Typography>
      )}
      <Button onClick={onStop} startIcon={<PersonRemoveIcon />} sx={{ alignSelf: 'flex-start' }}>
        Stop following
      </Button>
    </Paper>
  );
}
