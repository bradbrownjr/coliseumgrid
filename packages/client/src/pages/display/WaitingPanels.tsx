import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

/** What the TV shows before a bracket exists: the M3 frame with its two waiting messages. */
export function WaitingPanels() {
  return (
    <Box sx={{ width: '100%', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: { xs: 2, md: 4 } }}>
      <Panel title="Up next" accent>
        Waiting for the first match.
      </Panel>
      <Panel title="Match timer">Starts with the first match.</Panel>
    </Box>
  );
}

function Panel({ title, accent = false, children }: { title: string; accent?: boolean; children: ReactNode }) {
  return (
    <Box
      component="section"
      sx={{
        border: 2,
        // Up next is blue (docs/DESIGN.md, "Colors"); the heading also says it in words.
        borderColor: accent ? 'upNext.main' : 'divider',
        borderRadius: 2,
        p: { xs: 2, md: 4 },
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Typography variant="h3" component="h2" sx={accent ? { color: 'upNext.main' } : undefined}>
        {title}
      </Typography>
      <Typography variant="h4" component="p" sx={{ color: 'text.secondary' }}>
        {children}
      </Typography>
    </Box>
  );
}
