import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { Fragment } from 'react';
import { ordinal, splitTable, stepDown, tableTypeFor, type Screen, type StandingsLine, type TypeVariant } from './model.ts';
import { useScreen } from './useScreen.ts';

interface StandingsTableProps {
  rows: StandingsLine[];
  /** The two number columns: "Wins" and "Losses", or "Points" and "Groups". */
  headings: [string, string];
  /** A line under this many rows, with its label ("Top 4 go to the final"). */
  cut?: { after: number; label: string } | null;
  /** The type for the rows of one table; brackets use the default. */
  typeFor?: (rows: number, screen: Screen) => TypeVariant;
}

/**
 * Place, handle, and two numbers. With more than 16 players the rows split into two tables
 * side by side so the type stays large. The cut line is one row across the table's width.
 */
export function StandingsTable({ rows, headings, cut = null, typeFor = tableTypeFor }: StandingsTableProps) {
  const tables = splitTable(rows);
  const type = typeFor(tables[0]?.length ?? 0, useScreen());
  // The cell's own body2 type would win over the table's, so each cell takes the size.
  const cell = { typography: type, lineHeight: 1.25, py: { xs: 0.75, md: 0.5 }, px: 1.5, borderColor: 'divider' };
  const hasNotes = rows.some((row) => row.note !== null);

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: `repeat(${tables.length}, minmax(0, 1fr))` }, gap: 3 }}>
      {tables.map((table, index) => {
        const offset = index * (tables[0]?.length ?? 0);
        return (
          <Table key={index} aria-label="Standings" sx={{ tableLayout: 'fixed' }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...cell, width: '22%', color: 'text.secondary' }}>Place</TableCell>
                <TableCell sx={{ ...cell, color: 'text.secondary' }}>Handle</TableCell>
                <TableCell align="right" sx={{ ...cell, width: '20%', color: 'text.secondary' }}>
                  {headings[0]}
                </TableCell>
                <TableCell align="right" sx={{ ...cell, width: '22%', color: 'text.secondary' }}>
                  {headings[1]}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {cut && cut.after === 0 && index === 0 && <CutRow label={cut.label} cell={cell} type={type} />}
              {table.map((row, position) => (
                <Fragment key={row.key}>
                  <TableRow>
                    <TableCell sx={{ ...cell, color: 'text.primary' }}>{ordinal(row.place)}</TableCell>
                    <TableCell sx={{ ...cell, color: 'text.primary', fontWeight: 700, overflowWrap: 'anywhere' }}>
                      {row.handle}
                      {hasNotes && row.note && (
                        <Box component="span" sx={{ ml: '0.5em', fontSize: '0.7em', fontWeight: 400, color: 'warning.main' }}>
                          {row.note}
                        </Box>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ ...cell, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
                      {row.first}
                    </TableCell>
                    <TableCell align="right" sx={{ ...cell, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
                      {row.second}
                    </TableCell>
                  </TableRow>
                  {cut && offset + position + 1 === cut.after && <CutRow label={cut.label} cell={cell} type={type} />}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        );
      })}
    </Box>
  );
}

/** The cut line: one row across the table, its top border is the line. */
function CutRow({ label, cell, type }: { label: string; cell: object; type: TypeVariant }) {
  return (
    <TableRow>
      <TableCell
        colSpan={4}
        sx={{
          ...cell,
          py: 0.25,
          typography: stepDown(type, 1),
          textAlign: 'center',
          color: 'primary.light',
          fontWeight: 700,
          borderTop: 4,
          borderTopColor: 'primary.light',
          borderBottom: 0,
        }}
      >
        {label}
      </TableCell>
    </TableRow>
  );
}
