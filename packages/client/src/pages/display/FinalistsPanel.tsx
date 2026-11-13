import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { pointsText, scaleType, type Finalist } from './model.ts';

/** The final is on: the four finalists large, with the points they came in with. */
export function FinalistsPanel({ finalists }: { finalists: Finalist[] }) {
  return (
    <Box component="section" aria-label="Final" sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0 }}>
      <Typography component="h2" sx={{ typography: scaleType('h4'), color: 'text.secondary', lineHeight: 1.25 }}>
        Final
      </Typography>
      <Box
        component="ol"
        sx={{
          m: 0,
          p: 0,
          listStyle: 'none',
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
          gridAutoRows: { md: '1fr' },
          gap: { xs: 2, md: 3 },
        }}
      >
        {finalists.map(({ player, points }) => (
          <Box
            component="li"
            key={player.id}
            sx={{
              border: 2,
              borderColor: 'primary.light',
              borderRadius: 2,
              bgcolor: 'background.paper',
              px: { xs: 2, md: 3 },
              py: { xs: 1.5, md: 2 },
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 0.5,
              typography: scaleType('h2'),
              lineHeight: 1.15,
              fontWeight: 700,
            }}
          >
            <Box component="span" sx={{ overflowWrap: 'anywhere' }}>
              {player.handle}
            </Box>
            {points !== null && (
              <Box component="span" sx={{ fontSize: { xs: '0.75em', md: '0.4em' }, fontWeight: 400, color: 'text.secondary' }}>
                {pointsText(points)}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
