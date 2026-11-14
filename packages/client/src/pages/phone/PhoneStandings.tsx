import type { PhoneStandings as Standings } from '@coliseumgrid/core';
import PersonIcon from '@mui/icons-material/Person';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import type { Theme } from '@mui/material/styles';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { Fragment } from 'react';
import { cutWords } from '../../heatsWords.ts';
import { ordinal } from '../display/model.ts';
import { standingsHeading, standingsTable } from './phoneWords.ts';

interface PhoneStandingsProps {
  standings: Standings;
  /** The players this phone follows, so their rows stand out. */
  followedIds: ReadonlySet<number>;
}

const cell = { px: 0.75, py: 1, borderColor: 'divider', typography: 'body1', lineHeight: 1.3 } as const;
const head = { ...cell, typography: 'caption', color: 'text.secondary' } as const;

/** A column's width in theme spacing units, so the handle gets what is left at 320 pixels. */
const col = (units: number) => (theme: Theme) => theme.spacing(units);

/**
 * Everyone's standings, as the Display shows them (docs/PLAN.md, "Phone API"), in a table that
 * fits a phone: the rows of the players this phone follows are bold with a person icon, and
 * the cut line for groups reads "Top 4 go to the final".
 */
export function PhoneStandings({ standings, followedIds }: PhoneStandingsProps) {
  const table = standingsTable(standings);
  const cutLabel = standings.kind === 'heats' ? cutWords(standings.finalSize) : null;

  return (
    <Paper component="section" aria-labelledby="standings-heading" variant="outlined" sx={{ p: 1, minWidth: 0 }}>
      <Typography id="standings-heading" variant="h5" component="h2" sx={{ px: 1, py: 1, fontWeight: 700 }}>
        {table.noResultsYet ? 'Players' : standingsHeading(standings.finished)}
      </Typography>
      {table.noResultsYet ? (
        <>
          <Typography variant="body1" sx={{ px: 1, pb: 1, color: 'text.secondary' }}>
            Places start after the first group.
          </Typography>
          <Box component="ul" sx={{ m: 0, p: 0, px: 1, listStyle: 'none', display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}>
            {table.lines.map((line) => (
              <Box component="li" key={line.playerId} sx={{ typography: 'body1', fontWeight: followedIds.has(line.playerId) ? 700 : 400, overflowWrap: 'anywhere' }}>
                {line.handle}
              </Box>
            ))}
          </Box>
        </>
      ) : (
        <Table size="small" aria-label={standingsHeading(standings.finished)} sx={{ tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...head, width: col(6) }}>Place</TableCell>
              <TableCell sx={head}>Handle</TableCell>
              <TableCell align="right" sx={{ ...head, width: col(7) }}>
                {table.headings[0]}
              </TableCell>
              <TableCell align="right" sx={{ ...head, width: col(7) }}>
                {table.headings[1]}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {table.cutAfter === 0 && cutLabel && <CutRow label={cutLabel} />}
            {table.lines.map((line, index) => {
              const mine = followedIds.has(line.playerId);
              return (
                <Fragment key={line.playerId}>
                  <TableRow>
                    <TableCell sx={{ ...cell, fontWeight: mine ? 700 : 400, color: 'text.primary' }}>{ordinal(line.place)}</TableCell>
                    <TableCell sx={{ ...cell, fontWeight: mine ? 700 : 400, color: 'text.primary', overflowWrap: 'anywhere' }}>
                      {mine && <PersonIcon titleAccess="You follow this player" sx={{ fontSize: '1.1em', verticalAlign: 'text-bottom', mr: 0.5 }} />}
                      {line.handle}
                    </TableCell>
                    <TableCell align="right" sx={{ ...cell, fontWeight: mine ? 700 : 400, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
                      {line.first}
                    </TableCell>
                    <TableCell align="right" sx={{ ...cell, fontWeight: mine ? 700 : 400, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
                      {line.second}
                    </TableCell>
                  </TableRow>
                  {table.cutAfter === index + 1 && cutLabel && <CutRow label={cutLabel} />}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}

/** The cut line: one row across the table, its top border is the line (as on the Display). */
function CutRow({ label }: { label: string }) {
  return (
    <TableRow>
      <TableCell
        colSpan={4}
        // Crimson text on light, primary.light on dark (docs/DESIGN.md, "Colors"). The Display is always dark, so its line is primary.light only.
        sx={[
          { ...cell, py: 0.5, textAlign: 'center', fontWeight: 700, borderTop: 4, borderBottom: 0, color: 'primary.main', borderTopColor: 'primary.main' },
          (theme) => theme.applyStyles('dark', { color: theme.vars.palette.primary.light, borderTopColor: theme.vars.palette.primary.light }),
        ]}
      >
        {label}
      </TableCell>
    </TableRow>
  );
}
