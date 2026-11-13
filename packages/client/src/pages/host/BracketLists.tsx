import type { BracketMatch, StandingsRow, TieNotice } from '@coliseumgrid/core';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import UndoIcon from '@mui/icons-material/Undo';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { byePlayer, matchTitle, matchWords, placeWords, resultWords, tieWords } from './bracketWords.ts';

/** How many rows a long list shows before "Show all". A 32-player round robin has 496 matches. */
const SHORT_LIST = 8;

/** "Tie for 1st: Zap and Kai", with one "Play tie-break" button for the ties not started. */
export function TieNotices({ ties, busy, onPlay }: { ties: TieNotice[]; busy: boolean; onPlay: () => void }) {
  if (ties.length === 0) return null;
  const waiting = ties.some((tie) => !tie.started);
  return (
    <Alert severity="warning" sx={{ '.MuiAlert-message': { flex: 1, minWidth: 0 } }}>
      <Stack sx={{ gap: 1.5, alignItems: 'flex-start' }}>
        <Stack sx={{ gap: 0.5 }}>
          {ties.map((tie) => (
            <Typography key={tie.place} sx={{ overflowWrap: 'anywhere' }}>
              {tieWords(tie)}
              {tie.started && ' (tie-break is on the stations)'}
            </Typography>
          ))}
        </Stack>
        {waiting && (
          <Button color="inherit" variant="outlined" disabled={busy} onClick={onPlay}>
            Play tie-break
          </Button>
        )}
      </Stack>
    </Alert>
  );
}

/** The matches waiting for a station, in queue order. */
export function UpNext({ matches }: { matches: BracketMatch[] }) {
  return (
    <Stack sx={{ gap: 1 }}>
      <Typography variant="h6" component="h3">
        Up next
      </Typography>
      {matches.length === 0 ? (
        <Typography color="text.secondary">No matches are waiting.</Typography>
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {matches.slice(0, SHORT_LIST).map((match, index) => (
              <ListItem key={match.id} divider={index < Math.min(matches.length, SHORT_LIST) - 1 || matches.length > SHORT_LIST}>
                <ListItemText
                  primary={`${index + 1}. ${matchWords(match)}`}
                  secondary={matchTitle(match)}
                  slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }}
                />
              </ListItem>
            ))}
            {matches.length > SHORT_LIST && (
              <ListItem>
                <ListItemText secondary={`and ${matches.length - SHORT_LIST} more`} />
              </ListItem>
            )}
          </List>
        </Paper>
      )}
    </Stack>
  );
}

interface ResultsProps {
  /** Done matches, newest first. */
  done: BracketMatch[];
  byes: BracketMatch[];
  busy: boolean;
  onUndo: (match: BracketMatch) => void;
}

/** Every recorded result with an Undo (CLAUDE.md, hard rule 5), then the players who move on without playing. */
export function Results({ done, byes, busy, onUndo }: ResultsProps) {
  const [all, setAll] = useState(false);
  if (done.length === 0 && byes.length === 0) return null;
  const shown = all ? done : done.slice(0, SHORT_LIST);
  return (
    <Stack sx={{ gap: 1 }}>
      <Typography variant="h6" component="h3">
        Results
      </Typography>
      {done.length === 0 ? (
        <Typography color="text.secondary">No results yet.</Typography>
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {shown.map((match, index) => (
              <ListItem
                key={match.id}
                divider={index < shown.length - 1}
                sx={{ gap: 2, justifyContent: 'space-between', alignItems: 'center' }}
              >
                <ListItemIcon sx={{ minWidth: 0, color: 'win.main' }}>
                  <EmojiEventsIcon aria-hidden />
                </ListItemIcon>
                <ListItemText
                  sx={{ flex: '1 1 auto', minWidth: 0 }}
                  primary={resultWords(match)}
                  secondary={matchTitle(match)}
                  slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }}
                />
                <Button
                  variant="outlined"
                  startIcon={<UndoIcon />}
                  disabled={busy}
                  // The icon goes on a phone so a long handle keeps its room.
                  sx={(theme) => ({ flexShrink: 0, [theme.breakpoints.down('sm')]: { '.MuiButton-startIcon': { display: 'none' } } })}
                  aria-label={`Undo: ${resultWords(match)}`}
                  onClick={() => onUndo(match)}
                >
                  Undo
                </Button>
              </ListItem>
            ))}
          </List>
        </Paper>
      )}
      {done.length > SHORT_LIST && (
        <Button sx={{ alignSelf: 'flex-start' }} onClick={() => setAll((before) => !before)}>
          {all ? 'Show fewer' : `Show all ${done.length} results`}
        </Button>
      )}
      {byes.length > 0 && (
        <Typography color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {byes.map((match) => `${byePlayer(match)?.handle}: Moves on this round`).join('. ')}
        </Typography>
      )}
    </Stack>
  );
}

/** Final places with each player's wins and losses. */
export function Standings({ rows }: { rows: StandingsRow[] }) {
  return (
    <Stack sx={{ gap: 1 }}>
      <Typography variant="h6" component="h3">
        Final standings
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Place</TableCell>
              <TableCell>Handle</TableCell>
              <TableCell align="right">Wins</TableCell>
              <TableCell align="right">Losses</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.player.id}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {row.place <= 3 && <EmojiEventsIcon fontSize="small" aria-hidden sx={{ verticalAlign: 'middle', mr: 0.5, color: 'win.main' }} />}
                  {placeWords(row.place)}
                </TableCell>
                <TableCell component="th" scope="row" sx={{ overflowWrap: 'anywhere' }}>
                  {row.player.handle}
                </TableCell>
                <TableCell align="right">{row.wins}</TableCell>
                <TableCell align="right">{row.losses}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
