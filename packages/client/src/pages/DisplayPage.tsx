import type { Bracket, EventGraphic, EventInfo, Heats } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getBracket } from '../api/bracket.ts';
import { getHeats } from '../api/heats.ts';
import { getEvent } from '../api/host.ts';
import { AccessGate, useGoToJoin } from '../components/AccessGate.tsx';
import { EventPicture } from '../components/EventPicture.tsx';
import { Logo } from '../components/Logo.tsx';
import { useLive } from '../components/useLive.ts';
import { BracketSections } from './display/BracketSections.tsx';
import { FinalStandings } from './display/FinalStandings.tsx';
import { HeatsScreen } from './display/HeatsScreen.tsx';
import { StandingsTable } from './display/StandingsTable.tsx';
import { StationsPanel } from './display/StationsPanel.tsx';
import { TieBanner } from './display/TieBanner.tsx';
import { UpNextPanel } from './display/UpNextPanel.tsx';
import { bracketLines, bracketStationCards, bracketUpNext, stationLayout } from './display/model.ts';
import { useScreen } from './display/useScreen.ts';
import { WaitingPanels } from './display/WaitingPanels.tsx';

/**
 * The event's graphic beside its name (docs/DESIGN.md, "Name tags"). It is one line of the name's
 * type tall: `em` follows the heading's font size and `lineHeight`, so the picture is never
 * taller than a line of the name, whatever size the heading is at. A wide picture is held to a
 * share of the row so the name keeps room. On a phone the name drops under the picture when
 * both don't fit one row (the heading wraps), instead of breaking inside a word.
 */
function TitlePicture({ graphic }: { graphic: EventGraphic }) {
  return <EventPicture graphic={graphic} sx={{ flex: 'none', height: '1.1em', width: 'auto', maxWidth: '40%' }} />;
}

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
 * then, once a bracket or groups exist (an event runs one), the stations with their timers,
 * "Up next", and the bracket or the standings. Before that, the two waiting messages. It
 * reloads on each `bracket`, `heats`, and `players` message (a rename changes a handle) and
 * nothing here takes input.
 */
function DisplayFrame() {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [bracket, setBracket] = useState<Bracket | null>(null);
  const [heats, setHeats] = useState<Heats | null>(null);
  const latestLoad = useRef(0);
  const latestHeatsLoad = useRef(0);
  const screen = useScreen();
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

  const loadHeats = useCallback(async () => {
    const mine = ++latestHeatsLoad.current;
    const result = await getHeats();
    if (result.ok && mine === latestHeatsLoad.current) setHeats(result.data.heats);
  }, []);

  useEffect(() => {
    void loadEvent();
    void loadBracket();
    void loadHeats();
  }, [loadEvent, loadBracket, loadHeats]);

  // A message sent while the socket was down is lost, so each connect reads everything again.
  useLive({
    onMessage: (message) => {
      if (message.type === 'event') setEvent(message.event);
      if (message.type === 'bracket' || message.type === 'players') void loadBracket();
      if (message.type === 'heats' || message.type === 'players') void loadHeats();
    },
    onOpen: () => {
      void loadEvent();
      void loadBracket();
      void loadHeats();
    },
    onEnded: goToJoin,
  });

  const name = event?.name ?? 'ColiseumGrid';
  // The host typed it, or there is none (docs/DESIGN.md, "Display").
  const game = event?.game ?? null;
  const graphic = event?.graphic ?? null;

  if (bracket === null && heats === null) {
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
        <Box component="header">
          <Typography variant="h1" component="h1" sx={{ overflowWrap: 'anywhere', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: 3 }}>
            {graphic && <TitlePicture graphic={graphic} />}
            <span>{name}</span>
          </Typography>
          {game && (
            <Typography variant="h3" component="p" color="text.secondary" sx={{ overflowWrap: 'anywhere', mt: 1 }}>
              {game}
            </Typography>
          )}
        </Box>
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
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="h1"
            sx={{ typography: { xs: 'h4', xl: 'h3' }, overflowWrap: 'anywhere', lineHeight: 1.1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2 }}
          >
            {graphic && <TitlePicture graphic={graphic} />}
            <span>{name}</span>
          </Typography>
          {game && (
            <Typography component="p" color="text.secondary" sx={{ typography: { xs: 'h6', xl: 'h5' }, overflowWrap: 'anywhere', lineHeight: 1.2 }}>
              {game}
            </Typography>
          )}
        </Box>
      </Box>
      {bracket === null ? (
        heats && <HeatsScreen heats={heats} />
      ) : bracket.finished ? (
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
            <StationsPanel
              stations={bracketStationCards(bracket.stations)}
              layout={stationLayout(bracket.stations.length, screen)}
              idle="Waiting for a match"
              noShowMinutes={bracket.noShowMinutes}
            />
            <UpNextPanel entries={bracketUpNext(bracket.upNext)} empty="No matches waiting." />
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0 }}>
            <TieBanner ties={bracket.ties} />
            {bracket.format === 'round_robin' ? (
              <StandingsTable rows={bracketLines(bracket.standings)} headings={['Wins', 'Losses']} />
            ) : (
              <BracketSections bracket={bracket} />
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
