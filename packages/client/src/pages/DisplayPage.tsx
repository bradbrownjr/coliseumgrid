import type { EventInfo } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { getEvent } from '../api/host.ts';
import { AccessGate, useGoToJoin } from '../components/AccessGate.tsx';
import { Logo } from '../components/Logo.tsx';
import { useLive } from '../components/useLive.ts';

/**
 * The TV is always dark. The `mode-dark` class matches the theme's colorSchemeSelector, so
 * everything inside gets the dark values whatever the host picked. This page never calls
 * setMode, so it can't change the host's choice on a shared browser.
 */
export function DisplayPage() {
  return (
    <Box
      className="mode-dark"
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
        color: 'text.primary',
      }}
    >
      <AccessGate role="display">
        <DisplayFrame />
      </AccessGate>
    </Box>
  );
}

/**
 * The frame the bracket and standings will fill (docs/PLAN.md, "Devices and host API"): the
 * event name, live, and a place each for "Up next" and the match timer. Those two wait for
 * matches, which arrive in M4. Nothing here takes input.
 */
function DisplayFrame() {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const goToJoin = useGoToJoin();

  const load = useCallback(async () => {
    const result = await getEvent();
    if (result.ok) setEvent(result.data.event);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A message sent while the socket was down is lost, so each connect reads the event again.
  useLive({
    onMessage: (message) => {
      if (message.type === 'event') setEvent(message.event);
    },
    onOpen: () => void load(),
    onEnded: goToJoin,
  });

  return (
    <Box
      component="main"
      sx={{
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: { xs: 3, md: 6 },
        p: { xs: 2, md: 6 },
        textAlign: 'center',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Logo size={16} />
      {/* The theme's largest heading, scaled by its breakpoints. The TV's minimum type size is
          set in M3 by testing on the real TV (docs/DESIGN.md, "Display (TV)"). */}
      <Typography variant="h1" component="h1" sx={{ overflowWrap: 'anywhere' }}>
        {event?.name ?? 'ColiseumGrid'}
      </Typography>
      <Box sx={{ width: '100%', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: { xs: 2, md: 4 } }}>
        <Panel title="Up next" accent>
          Waiting for the first match.
        </Panel>
        <Panel title="Match timer">Starts with the first match.</Panel>
      </Box>
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
