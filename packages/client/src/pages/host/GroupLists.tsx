import type { Heat, HeatStandingsRow } from '@coliseumgrid/core';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
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
import { placeWords } from './bracketWords.ts';
import { SHORT_LIST, UndoButton } from './BracketLists.tsx';
import { joinHandles } from '../../handles.ts';
import { cutWords, heatTitle, orderWords } from './groupWords.ts';

/** More standings rows than this start folded to the top; 32 players is a long table. */
const SHORT_STANDINGS = 12;

/** The groups waiting for a station, in queue order. */
export function UpNextGroups({ heats, all }: { heats: Heat[]; all: readonly Heat[] }) {
  return (
    <Stack sx={{ gap: 1 }}>
      <Typography variant="h6" component="h3">
        Up next
      </Typography>
      {heats.length === 0 ? (
        <Typography color="text.secondary">No groups are waiting.</Typography>
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {heats.slice(0, SHORT_LIST).map((heat, index) => (
              <ListItem key={heat.id} divider={index < Math.min(heats.length, SHORT_LIST) - 1 || heats.length > SHORT_LIST}>
                <ListItemText
                  primary={`${index + 1}. ${heatTitle(heat, all)}`}
                  secondary={joinHandles(heat.players)}
                  slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } }, secondary: { sx: { overflowWrap: 'anywhere' } } }}
                />
              </ListItem>
            ))}
            {heats.length > SHORT_LIST && (
              <ListItem>
                <ListItemText secondary={`and ${heats.length - SHORT_LIST} more`} />
              </ListItem>
            )}
          </List>
        </Paper>
      )}
    </Stack>
  );
}

interface GroupResultsProps {
  /** Done groups, newest first. */
  done: Heat[];
  all: readonly Heat[];
  busy: boolean;
  onUndo: (heat: Heat) => void;
}

/** Every recorded result with an Undo (CLAUDE.md, hard rule 5). */
export function GroupResults({ done, all, busy, onUndo }: GroupResultsProps) {
  const [showAll, setShowAll] = useState(false);
  if (done.length === 0) return null;
  const shown = showAll ? done : done.slice(0, SHORT_LIST);
  return (
    <Stack sx={{ gap: 1 }}>
      <Typography variant="h6" component="h3">
        Results
      </Typography>
      <Paper variant="outlined">
        <List disablePadding>
          {shown.map((heat, index) => (
            <ListItem key={heat.id} divider={index < shown.length - 1} sx={{ gap: 2, justifyContent: 'space-between', alignItems: 'center' }}>
              <ListItemIcon sx={{ minWidth: 0, color: 'win.main' }}>
                <EmojiEventsIcon aria-hidden />
              </ListItemIcon>
              <ListItemText
                sx={{ flex: '1 1 auto', minWidth: 0 }}
                primary={heatTitle(heat, all)}
                secondary={heat.order ? orderWords(heat.order) : null}
                slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } }, secondary: { sx: { overflowWrap: 'anywhere' } } }}
              />
              <UndoButton busy={busy} label={`Undo: ${heatTitle(heat, all)}`} onClick={() => onUndo(heat)} />
            </ListItem>
          ))}
        </List>
      </Paper>
      {done.length > SHORT_LIST && (
        <Button sx={{ alignSelf: 'flex-start' }} onClick={() => setShowAll((before) => !before)}>
          {showAll ? 'Show fewer' : `Show all ${done.length} results`}
        </Button>
      )}
    </Stack>
  );
}

interface GroupStandingsProps {
  rows: HeatStandingsRow[];
  finished: boolean;
  finalSize: number;
  /** Rows above the cut line (from `heatCutAfter`, so the line sits above a tied group); null for no line. */
  cutAfter: number | null;
  /** False when 2 to 4 players played only the final: nobody has qualifying points. */
  points: boolean;
}

/**
 * Standings by points, with the cut line under the last place that reaches the final. Once the
 * final is done the places are the final's: 1st to 3rd are never shared (docs/PLAN.md, "Ties").
 */
export function GroupStandings({ rows, finished, finalSize, cutAfter, points }: GroupStandingsProps) {
  const [showAll, setShowAll] = useState(false);
  const folded = rows.length > SHORT_STANDINGS && !showAll;
  const shown = folded ? rows.slice(0, SHORT_STANDINGS) : rows;
  const cutHere = !finished && points ? cutAfter : null;
  const columns = points ? 4 : 2;
  return (
    <Stack sx={{ gap: 1 }}>
      <Typography variant="h6" component="h3">
        {finished ? 'Final standings' : 'Standings'}
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" sx={{ '.MuiTableCell-root': { px: { xs: 1, sm: 2 } } }}>
          <TableHead>
            <TableRow>
              <TableCell>Place</TableCell>
              <TableCell>Handle</TableCell>
              {points && <TableCell align="right">Points</TableCell>}
              {points && <TableCell align="right">Groups</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.flatMap((row, index) => {
              const cutRow = (
                <TableRow key="cut">
                  <TableCell
                    colSpan={columns}
                    sx={(theme) => ({
                      borderTop: `${theme.spacing(0.5)} solid`,
                      borderTopColor: 'primary.main',
                      color: 'text.secondary',
                      typography: 'body2',
                      ...theme.applyStyles('dark', { borderTopColor: theme.vars.palette.primary.light }),
                    })}
                  >
                    {cutWords(finalSize)}
                  </TableCell>
                </TableRow>
              );
              const line = (
                <TableRow key={row.player.id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {row.place <= 3 && finished && <EmojiEventsIcon fontSize="small" aria-hidden sx={{ verticalAlign: 'middle', mr: 0.5, color: 'win.main' }} />}
                    {placeWords(row.place)}
                  </TableCell>
                  <TableCell component="th" scope="row" sx={{ overflowWrap: 'anywhere' }}>
                    {row.player.handle}
                  </TableCell>
                  {points && <TableCell align="right">{row.points}</TableCell>}
                  {points && <TableCell align="right">{row.heatsPlayed}</TableCell>}
                </TableRow>
              );
              // The line sits above row 1 when everyone at the cut is level, otherwise under row `cutHere`.
              if (cutHere === 0 && index === 0) return [cutRow, line];
              return cutHere === index + 1 ? [line, cutRow] : [line];
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {rows.length > SHORT_STANDINGS && (
        <Button sx={{ alignSelf: 'flex-start' }} onClick={() => setShowAll((before) => !before)}>
          {showAll ? 'Show fewer' : `Show all ${rows.length} players`}
        </Button>
      )}
    </Stack>
  );
}
