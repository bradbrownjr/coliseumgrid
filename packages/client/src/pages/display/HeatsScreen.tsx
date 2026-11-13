import type { Heats } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { FinalStandings } from './FinalStandings.tsx';
import { FinalistsPanel } from './FinalistsPanel.tsx';
import { PlayersList } from './PlayersList.tsx';
import { StandingsTable } from './StandingsTable.tsx';
import { StationsPanel } from './StationsPanel.tsx';
import { TieBanner } from './TieBanner.tsx';
import { UpNextPanel } from './UpNextPanel.tsx';
import {
  finalHeat,
  finalists,
  heatLines,
  heatRoundText,
  heatStationCards,
  heatStationLayout,
  heatTableType,
  heatUpNext,
  scaleType,
} from './model.ts';
import { useScreen } from './useScreen.ts';
import { heatCutAfter, heatTieMessage, noResultsYet } from '../../heatsWords.ts';

/**
 * The TV for races and free-for-alls (docs/PLAN.md, "Races and free-for-all"): the stations and
 * Up next on the left; on the right the standings by points with the cut line, then the
 * finalists once the final is made. A finished event shows the final standings instead.
 */
export function HeatsScreen({ heats }: { heats: Heats }) {
  const screen = useScreen();
  if (heats.finished) return <FinalStandings standings={heats.standings} />;

  const final = finalHeat(heats);
  const lines = heatLines(heats);
  const cut = heatCutAfter(heats);
  const round = heatRoundText(heats);
  const waiting = noResultsYet(heats);

  return (
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
          stations={heatStationCards(heats.stations)}
          layout={heatStationLayout(heats.stations.length, screen)}
          idle="Waiting for a group"
          noteBelow
        />
        <UpNextPanel entries={heatUpNext(heats.upNext)} empty="No groups waiting." />
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0 }}>
        <TieBanner ties={heats.ties} message={(tie) => heatTieMessage(tie, heats)} />
        {final ? (
          <FinalistsPanel finalists={finalists(heats, final)} />
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
              <Typography component="h2" sx={{ typography: scaleType('h4'), color: 'text.secondary', lineHeight: 1.25 }}>
                {waiting ? 'Players' : 'Standings'}
              </Typography>
              {round && (
                <Typography component="p" sx={{ typography: scaleType('h4'), lineHeight: 1.25 }}>
                  {round}
                </Typography>
              )}
            </Box>
            {waiting ? (
              <PlayersList players={heats.standings.map((row) => row.player)} />
            ) : (
              <StandingsTable
                rows={lines}
                headings={['Points', 'Groups']}
                typeFor={heatTableType}
                cut={cut === null ? null : { after: cut, label: `Top ${heats.finalSize} go to the final` }}
              />
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
