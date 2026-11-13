import type { Bracket, EventInfo } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getBracket } from '../api/bracket.ts';
import { getEvent } from '../api/host.ts';
import { AccessGate, useGoToJoin } from '../components/AccessGate.tsx';
import { Logo } from '../components/Logo.tsx';
import { useLive } from '../components/useLive.ts';
import { BracketSections } from './display/BracketSections.tsx';
import { FinalStandings } from './display/FinalStandings.tsx';
import { StandingsTable } from './display/StandingsTable.tsx';
import { StationsPanel } from './display/StationsPanel.tsx';
import { TieBanner } from './display/TieBanner.tsx';
import { UpNextPanel } from './display/UpNextPanel.tsx';
import { WaitingPanels } from './display/WaitingPanels.tsx';

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
 * The TV (docs/PLAN.md, "Devices and host API" and "Stations and the queue"): the event name,
 * then, once a bracket exists, the stations with their timers, "Up next", and the bracket or
 * the standings. Before that, the two waiting messages. It reloads the bracket on each
 * `bracket` and `players` message (a rename changes a handle) and nothing here takes input.
 */
function DisplayFrame() {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [bracket, setBracket] = useState<Bracket | null>(null);
  const latestLoad = useRef(0);
  const goToJoin = useGoToJoin();

  const loadEvent = useCallback(async () => {
    const result = await getEvent();
    if (result.ok) setEvent(result.data.event);
  }, []);

  const loadBracket = useCallback(async () => {
    // Two loads can finish out of order; only the newest request may set the screen.
    const mine = ++latestLoad.current;
    const result = await getBracket();
    if (result.ok && mine === latestLoad.current) setBracket(result.data.bracket);
  }, []);

  useEffect(() => {
    void loadEvent();
    void loadBracket();
  }, [loadEvent, loadBracket]);

  // A message sent while the socket was down is lost, so each connect reads everything again.
  useLive({
    onMessage: (message) => {
      if (message.type === 'event') setEvent(message.event);
      if (message.type === 'bracket' || message.type === 'players') void loadBracket();
    },
    onOpen: () => {
      void loadEvent();
      void loadBracket();
    },
    onEnded: goToJoin,
  });

  const name = event?.name ?? 'ColiseumGrid';

  if (bracket === null) {
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
        {/* The theme's largest heading, scaled by its breakpoints. */}
        <Typography variant="h1" component="h1" sx={{ overflowWrap: 'anywhere' }}>
          {name}
        </Typography>
        <WaitingPanels />
      </Box>
    );
  }

  // From a tablet up the page is exactly one screen tall: a TV can't scroll.
  return (
    <Box
      component="main"
      sx={{
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        p: { xs: 2, md: 2, xl: 3 },
        minHeight: 0,
        height: { md: '100dvh' },
        overflow: { md: 'hidden' },
      }}
    >
      <Box component="header" sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <Logo size={6} />
        <Typography component="h1" sx={{ typography: { xs: 'h4', xl: 'h3' }, overflowWrap: 'anywhere', lineHeight: 1.1 }}>
          {name}
        </Typography>
      </Box>
      {bracket.finished ? (
        <FinalStandings standings={bracket.standings} />
      ) : (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 3fr)' },
            gap: { xs: 2, md: 3 },
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0 }}>
            <StationsPanel stations={bracket.stations} />
            <UpNextPanel matches={bracket.upNext} />
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0 }}>
            <TieBanner ties={bracket.ties} />
            {bracket.format === 'round_robin' ? (
              <StandingsTable rows={bracket.standings} />
            ) : (
              <BracketSections bracket={bracket} />
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
