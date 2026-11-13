import type { StandingsRow } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { ordinal, splitTable, tableTypeFor } from './model.ts';
import { useScreen } from './useScreen.ts';

/**
 * Everyone plays everyone: place, handle, wins, and losses. With more than 16 players the rows
 * split into two tables side by side so the type stays large.
 */
export function StandingsTable({ rows }: { rows: StandingsRow[] }) {
  const tables = splitTable(rows);
  const type = tableTypeFor(tables[0]?.length ?? 0, useScreen());
  // The cell's own body2 type would win over the table's, so each cell takes the size.
  const cell = { typography: type, lineHeight: 1.25, py: { xs: 0.75, md: 0.5 }, px: 1.5, borderColor: 'divider' };

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: `repeat(${tables.length}, minmax(0, 1fr))` }, gap: 3 }}>
      {tables.map((table, index) => (
        <Table key={index} aria-label="Standings" sx={{ tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...cell, width: '22%', color: 'text.secondary' }}>Place</TableCell>
              <TableCell sx={{ ...cell, color: 'text.secondary' }}>Handle</TableCell>
              <TableCell align="right" sx={{ ...cell, width: '18%', color: 'text.secondary' }}>
                Wins
              </TableCell>
              <TableCell align="right" sx={{ ...cell, width: '20%', color: 'text.secondary' }}>
                Losses
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {table.map((row) => (
              <TableRow key={row.player.id}>
                <TableCell sx={{ ...cell, color: 'text.primary' }}>{ordinal(row.place)}</TableCell>
                <TableCell sx={{ ...cell, color: 'text.primary', fontWeight: 700, overflowWrap: 'anywhere' }}>
                  {row.player.handle}
                </TableCell>
                <TableCell align="right" sx={{ ...cell, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
                  {row.wins}
                </TableCell>
                <TableCell align="right" sx={{ ...cell, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
                  {row.losses}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ))}
    </Box>
  );
}
