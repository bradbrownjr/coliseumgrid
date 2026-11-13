import type { Bracket } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { MatchCard } from './MatchCard.tsx';
import { useScreen } from './useScreen.ts';
import {
  buildSections,
  densityFor,
  scaleType,
  sectionRows,
  totalRows,
  type DisplayColumn,
} from './model.ts';

/**
 * The bracket as round columns: the earliest unfinished round and the two after it. On a
 * phone the columns stack; from a tablet up they sit side by side and fill the height.
 */
export function BracketSections({ bracket }: { bracket: Bracket }) {
  const sections = buildSections(bracket);
  const density = densityFor(totalRows(sections), useScreen());
  const stationOf = new Map(bracket.stations.flatMap((station) => (station.match ? [[station.match.id, station.number]] : [])));
  const hasRematch = bracket.matches.some((match) => match.side === 'rematch');

  const renderColumn = (column: DisplayColumn) => (
    <Box
      key={column.key}
      sx={{ flex: `${column.chunks.length} 1 0`, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      {column.heading && (
        <Typography component="h3" sx={{ typography: scaleType('h6'), color: 'text.secondary', lineHeight: 1.25 }}>
          {column.heading}
        </Typography>
      )}
      <Box sx={{ flex: 1, display: 'flex', gap: 1 }}>
        {column.chunks.map((matches, index) => (
          <Box
            key={index}
            sx={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: { xs: 'flex-start', md: 'space-around' },
              gap: density.tight ? 0.25 : density.compact ? 0.5 : 1,
            }}
          >
            {matches.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                format={bracket.format}
                hasRematch={hasRematch}
                station={stationOf.get(match.id)}
                density={density}
              />
            ))}
            {column.extra && index === column.chunks.length - 1 && (
              <Box key="extra" sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
                <Typography component="h4" sx={{ typography: scaleType('h6'), color: 'text.secondary', lineHeight: 1.25 }}>
                  {column.extra.heading}
                </Typography>
                <MatchCard
                  match={column.extra.match}
                  format={bracket.format}
                  hasRematch={hasRematch}
                  station={stationOf.get(column.extra.match.id)}
                  density={density}
                />
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 3, md: 1 }, flex: 1, minHeight: 0 }}>
      {sections.map((section) => (
        <Box
          key={section.key}
          component="section"
          sx={{ flex: { md: `${sectionRows(section)} 1 auto` }, display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          {section.title && (
            <Typography component="h2" sx={{ typography: scaleType('h5'), color: 'text.primary', lineHeight: 1.25 }}>
              {section.title}
            </Typography>
          )}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 2, md: 2 } }}>
            {section.columns.map((column) => renderColumn(column))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
