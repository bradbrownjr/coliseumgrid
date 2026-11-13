import TrophyIcon from '@mui/icons-material/EmojiEvents';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ordinal, scaleType, splitPodium, type PlacedPlayer, type TypeVariant } from './model.ts';

// 1st is the largest; 2nd and 3rd are a step smaller (docs/DESIGN.md has no TV size yet).
const PODIUM_TYPE: Record<number, TypeVariant> = { 1: 'h1', 2: 'h2', 3: 'h2' };

/** The finished event: places 1 to 3 large, 1st in the win color, then everyone else. */
export function FinalStandings({ standings }: { standings: PlacedPlayer[] }) {
  const { podium, rest } = splitPodium(standings);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 2, md: 3 }, minHeight: 0 }}>
      <Typography variant="h4" component="h2" sx={{ color: 'text.secondary' }}>
        Final standings
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {podium.map((group) => {
          const first = group.place === 1;
          return (
            <Box
              key={group.place}
              sx={{
                border: 2,
                borderColor: first ? 'win.main' : 'divider',
                borderRadius: 2,
                bgcolor: 'background.paper',
                px: { xs: 2, md: 4 },
                py: { xs: 1.5, md: 2 },
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                columnGap: 3,
                typography: scaleType(PODIUM_TYPE[group.place] ?? 'h3'),
                lineHeight: 1.2,
                color: first ? 'win.main' : 'text.primary',
                fontWeight: 700,
              }}
            >
              {first && <TrophyIcon titleAccess="Winner" sx={{ fontSize: '1em' }} />}
              <Box component="span" sx={{ minWidth: '2.4em', color: first ? 'inherit' : 'text.secondary' }}>
                {ordinal(group.place)}
              </Box>
              <Box component="span" sx={{ overflowWrap: 'anywhere' }}>
                {group.rows.map((row) => row.player.handle).join(', ')}
              </Box>
            </Box>
          );
        })}
      </Box>
      {rest.length > 0 && (
        <Box
          component="ol"
          sx={{
            m: 0,
            p: 0,
            listStyle: 'none',
            display: 'grid',
            // em, so the columns follow the type size: about five across on the TV and on a laptop.
            gridTemplateColumns: 'repeat(auto-fill, minmax(10em, 1fr))',
            columnGap: 3,
            rowGap: 0.5,
            typography: scaleType('h4'),
            lineHeight: 1.25,
          }}
        >
          {rest.map((row) => (
            <Box component="li" key={row.player.id} sx={{ display: 'flex', gap: 1.5, minWidth: 0 }}>
              <Box component="span" sx={{ minWidth: '2.6em', color: 'text.secondary' }}>
                {ordinal(row.place)}
              </Box>
              <Box component="span" sx={{ overflowWrap: 'anywhere' }}>
                {row.player.handle}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
