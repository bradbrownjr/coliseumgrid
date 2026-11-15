import { planDefaults, type BracketStation, type HeatStation, type Player } from '@coliseumgrid/core';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EstimatePanel } from '../src/pages/host/EstimatePanel.tsx';
import { GroupStations } from '../src/pages/host/GroupStations.tsx';
import { StationGrid } from '../src/pages/host/StationGrid.tsx';
import { NameStep, PlanStep } from '../src/pages/host/WizardSteps.tsx';
import { theme } from '../src/theme/theme.ts';

const render = (element: ReactElement) => renderToString(<ThemeProvider theme={theme}>{element}</ThemeProvider>);
const none = () => undefined;
const fighting = planDefaults('fighting');

describe('step 1', () => {
  const step = (newEvent: boolean) =>
    render(
      <NameStep newEvent={newEvent} name="" game="" words={null} template="fighting" onName={none} onGame={none} onDice={none} onTemplate={none} />,
    );

  it('has the name with the dice, the optional game, and the three template cards', () => {
    const html = step(false);
    expect(html).toContain('Event name');
    expect(html).toContain('aria-label="Pick a name for me"');
    expect(html).toContain('What game are you playing?');
    expect(html).toContain('You can leave this empty.');
    for (const name of ['Fighting game', 'Racing game', 'Another game']) expect(html).toContain(name);
    expect(html).not.toContain('Players sign up again for this event.');
  });

  it('says players sign up again in new-event mode', () => {
    expect(step(true)).toContain('Players sign up again for this event.');
  });
});

describe('a refusal from the server on step 1', () => {
  const helperTexts = (html: string) => [...html.matchAll(/<p class="[^"]*MuiFormHelperText[^"]*"[^>]*>(.*?)<\/p>/g)].map((m) => ({ error: /Mui-error/.test(m[0]), text: m[1] }));
  const step = (name: string, game: string) =>
    render(<NameStep newEvent={false} name={name} game={game} words="Something went wrong. Try again." template="fighting" onName={none} onGame={none} onDice={none} onTemplate={none} />);

  it('shows under the game when the game is what the server cannot take', () => {
    const [nameHelp, gameHelp] = helperTexts(step('Spring Bash', 'x'.repeat(61)));
    expect(nameHelp).toEqual({ error: false, text: 'Shows on the TV. Up to 60 characters.' });
    expect(gameHelp).toEqual({ error: true, text: 'Something went wrong. Try again.' });
  });

  it('shows under the name when the name is the problem, or when both are fine', () => {
    for (const html of [step('x'.repeat(61), 'Racing game'), step('Spring Bash', 'Racing game')]) {
      const [nameHelp, gameHelp] = helperTexts(html);
      expect(nameHelp).toEqual({ error: true, text: 'Something went wrong. Try again.' });
      expect(gameHelp).toEqual({ error: false, text: 'You can leave this empty.' });
    }
  });
});

describe('step 2', () => {
  it('has the three cards, the estimate line, and More options for the picked card', () => {
    const html = render(<PlanStep plan={fighting} points={['4', '3', '2', '1']} players={16} onPlayers={none} onPlan={none} onPoints={none} />);
    for (const name of ['1 vs 1 bracket', 'Everyone plays everyone', 'Races and free-for-all']) expect(html).toContain(name);
    expect(html).toContain('players, this takes about 2 hours 30 minutes');
    expect(html).toContain('More options');
    for (const label of ['Lives', 'Best of', 'Stations', 'Minutes for one game', 'Changeover minutes', 'Time you have', 'Wait for a missing player']) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('Games in each group');
  });

  it('shows the group options and a race for the racing template', () => {
    const racing = planDefaults('racing');
    const html = render(<PlanStep plan={racing} points={['4', '3', '2', '1']} players={16} onPlayers={none} onPlan={none} onPoints={none} />);
    expect(html).toContain('Games in each group');
    expect(html).toContain('Rounds before the final');
    expect(html).toContain('Points for each place');
    expect(html).toContain('Minutes for one race');
    expect(html).not.toContain('Lives');
  });
});

describe('the estimate and its warning', () => {
  const double = { ...fighting, format: 'double' as const };

  it('warns in words when the estimate is longer than the time the host has, with the two best fixes', () => {
    const html = render(<EstimatePanel plan={double} players={16} onPlayers={none} onFix={none} />);
    expect(html).toContain('players, this takes about 4 hours 45 minutes');
    expect(html).toContain('That is longer than the 3 hours you have.');
    expect(html).toContain('Pick One life');
    expect(html).toContain('Add a station');
  });

  it('has no warning when the event fits', () => {
    const html = render(<EstimatePanel plan={fighting} players={16} onPlayers={none} onFix={none} />);
    expect(html).not.toContain('That is longer');
  });

  it('shows the problem words when the format cannot start with that many', () => {
    expect(render(<EstimatePanel plan={double} players={2} onPlayers={none} onFix={none} />)).toContain('Two lives needs at least 3 players.');
  });

  it('shows the time and the finish on step 3', () => {
    const html = render(<EstimatePanel plan={fighting} players={16} now={Date.UTC(2026, 10, 14, 18, 0)} onFix={none} />);
    expect(html).toContain('About 2 hours 30 minutes');
    expect(html).toContain('Done around');
  });
});

describe('a station waiting for a missing player', () => {
  const zap: Player = { id: 1, handle: 'Zap' };
  const kai: Player = { id: 2, handle: 'Kai' };
  const calledAt = '2026-11-14T18:00:00.000Z';
  const minutesIn = (minutes: number) => Date.parse(calledAt) + minutes * 60_000;
  const match: BracketStation = {
    number: 2,
    calledAt,
    arrived: false,
    match: { id: 7, side: 'main', round: 1, number: 1, status: 'playing', slots: [{ player: zap, bye: false }, { player: kai, bye: false }], winner: null, forfeit: false, resultId: null },
  };
  const group: HeatStation = {
    number: 1,
    calledAt,
    arrived: false,
    heat: { id: 101, kind: 'round', round: 1, number: 1, status: 'playing', players: [zap, kai], order: null, missing: [], resultId: null },
  };
  const bracketCard = (now: number, station: BracketStation = match) =>
    render(<StationGrid stations={[station]} bestOf={1} now={now} busy={false} noShowMinutes={5} onWinner={none} onHere={none} onForfeit={none} />);
  const groupCard = (now: number, station: HeatStation = group) =>
    render(<GroupStations stations={[station]} heats={[group.heat!]} now={now} busy={false} noShowMinutes={10} onRecord={none} onHere={none} onForfeit={none} />);

  it('asks "Still waiting?" with They\'re here and Forfeit once the wait is over, on a match', () => {
    expect(bracketCard(minutesIn(4))).not.toContain('Still waiting?');
    const html = bracketCard(minutesIn(5));
    expect(html).toContain('Still waiting?');
    expect(html).toContain('They&#x27;re here');
    expect(html).toContain('Forfeit');
  });

  it('does the same on a group, with its own wait', () => {
    expect(groupCard(minutesIn(9))).not.toContain('Still waiting?');
    const html = groupCard(minutesIn(10));
    expect(html).toContain('Still waiting?');
    expect(html).toContain('They&#x27;re here');
    expect(html).toContain('Forfeit');
  });

  it('puts the prompt away for a call the host said they are here for, however long the wait', () => {
    expect(bracketCard(minutesIn(60), { ...match, arrived: true })).not.toContain('Still waiting?');
    expect(groupCard(minutesIn(60), { ...group, arrived: true })).not.toContain('Still waiting?');
    // The timer and the buttons for the result stay.
    const html = bracketCard(minutesIn(60), { ...match, arrived: true });
    expect(html).toContain('Zap<!-- --> won');
    expect(html).toContain('role="timer"');
  });
});
