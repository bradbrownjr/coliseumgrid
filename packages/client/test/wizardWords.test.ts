import { estimatePlan, planDefaults, type Estimate, type EventPlan } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import {
  CARD_CHOICES,
  FIX_WORDS,
  STEP_LABELS,
  TEMPLATE_CHOICES,
  aboutWords,
  cardOf,
  durationWords,
  estimatePlayersStart,
  estimateWords,
  finishWords,
  hoursWords,
  minutesLabel,
  newEventBlockedWords,
  planSummary,
  samePlan,
  signedUpWords,
  templateLine,
  tooLongWords,
  withCard,
  withTemplate,
} from '../src/pages/host/wizardWords.ts';

const fighting = planDefaults('fighting');
const estimateOf = (plan: EventPlan, players: number): Estimate => {
  const estimate = estimatePlan(plan, players);
  if (!estimate) throw new Error('no estimate');
  return estimate;
};
const minutes = (high: number): Estimate => ({ matches: { low: 1, high: 1 }, waves: { low: 1, high: 1 }, minutesPerWave: high, minutes: { low: high, high } });

describe('the steps and the cards', () => {
  it('labels the three steps', () => {
    expect(STEP_LABELS).toEqual(['Name and game', 'How to play', 'Start']);
  });

  it('builds each template line from the template defaults', () => {
    expect(TEMPLATE_CHOICES.map((choice) => [choice.name, choice.line])).toEqual([
      ['Fighting game', '1 vs 1 bracket, 5 minutes a game.'],
      ['Racing game', 'Races and free-for-all, 4 minutes a race.'],
      ['Another game', '1 vs 1 bracket, 5 minutes a game.'],
    ]);
    expect(templateLine('racing')).toBe(`Races and free-for-all, ${planDefaults('racing').minutesPerGame} minutes a race.`);
  });

  it('has the three format cards with the lines the start dialog had', () => {
    expect(CARD_CHOICES.map((choice) => [choice.name, choice.line])).toEqual([
      ['1 vs 1 bracket', 'Players face off one on one. Winners move on.'],
      ['Everyone plays everyone', 'Every player plays all the others. The most wins takes 1st.'],
      ['Races and free-for-all', 'Groups of up to 4 score points by place. The top 4 play a final.'],
    ]);
  });

  it('puts One life and Two lives on the bracket card', () => {
    expect(cardOf('single')).toBe('bracket');
    expect(cardOf('double')).toBe('bracket');
    expect(cardOf('round_robin')).toBe('round_robin');
    expect(cardOf('heats')).toBe('heats');
  });

  it('starts the bracket card on One life and keeps Two lives when the card is tapped again', () => {
    expect(withCard({ ...fighting, format: 'heats' }, 'bracket').format).toBe('single');
    const double = { ...fighting, format: 'double' as const };
    expect(withCard(double, 'bracket')).toBe(double);
    expect(withCard(fighting, 'round_robin')).toEqual({ ...fighting, format: 'round_robin' });
  });

  it('calls the minutes setting a race with the racing template', () => {
    expect(minutesLabel('racing')).toBe('Minutes for one race');
    expect(minutesLabel('fighting')).toBe('Minutes for one game');
    expect(minutesLabel('other')).toBe('Minutes for one game');
  });
});

describe('picking a template', () => {
  const changed: EventPlan = { ...fighting, stations: 3, bestOf: 3 };

  it('keeps the plan when the same template is tapped', () => {
    expect(withTemplate(changed, 'fighting', null)).toBe(changed);
  });

  it('puts the new template defaults over every step 2 choice', () => {
    expect(withTemplate(changed, 'racing', changed)).toEqual(planDefaults('racing'));
    expect(withTemplate(changed, 'other', null)).toEqual(planDefaults('other'));
  });

  it('brings the saved plan back when the saved template is picked again', () => {
    const racing = planDefaults('racing');
    expect(withTemplate(racing, 'fighting', changed)).toBe(changed);
  });
});

describe('the estimate in words', () => {
  it('rounds to 5 minutes under an hour', () => {
    expect(durationWords(36)).toBe('35 minutes');
    expect(durationWords(43)).toBe('45 minutes');
    expect(durationWords(2)).toBe('5 minutes');
  });

  it('rounds to 15 minutes from an hour', () => {
    expect(durationWords(60)).toBe('1 hour');
    expect(durationWords(120)).toBe('2 hours');
    expect(durationWords(131)).toBe('2 hours 15 minutes');
    expect(durationWords(279)).toBe('4 hours 45 minutes');
    expect(durationWords(97)).toBe('1 hour 30 minutes');
  });

  it('says "About" with the high end', () => {
    expect(aboutWords(minutes(43))).toBe('About 45 minutes');
    expect(aboutWords(minutes(134))).toBe('About 2 hours 15 minutes');
  });

  it('writes the step 2 line for the examples in PLAN.md', () => {
    // 16 players in Two lives, best of 1, 1 station, 9 minutes a match: 279 minutes at the high end.
    const double = { ...fighting, format: 'double' as const };
    expect(estimateWords(16, estimateOf(double, 16))).toBe('With 16 players, this takes about 4 hours 45 minutes');
    // Everyone plays everyone with 16 players: 123 matches on one station.
    expect(estimateWords(16, estimateOf({ ...fighting, format: 'round_robin' }, 16))).toBe('With 16 players, this takes about 18 hours 30 minutes');
    expect(estimateWords(16, estimateOf(fighting, 16))).toBe('With 16 players, this takes about 2 hours 30 minutes');
  });

  it('gives the finish time from the clock, rounded the same way', () => {
    const now = Date.UTC(2026, 10, 14, 18, 0);
    // 134 minutes shows as 2 hours 15 minutes, so done at 20:15.
    expect(finishWords(minutes(134), now, 'en-US', 'UTC').replace(/\s/g, ' ')).toBe('Done around 8:15 PM');
    expect(finishWords(minutes(43), now, 'en-GB', 'UTC')).toBe('Done around 18:45');
  });

  it('warns in words with the hours the host has', () => {
    expect(tooLongWords(3)).toBe('That is longer than the 3 hours you have.');
    expect(tooLongWords(1)).toBe('That is longer than the 1 hour you have.');
    expect(hoursWords(6)).toBe('6 hours');
  });

  it('labels every fix as DESIGN.md has it', () => {
    expect(FIX_WORDS).toEqual({
      station: 'Add a station',
      'one-life': 'Pick One life',
      'best-of-1': 'Play best of 1',
      bracket: 'Pick 1 vs 1 bracket',
      'fewer-games': 'Play fewer games in each group',
      'one-round': 'Play 1 round before the final',
    });
  });

  it('starts the players picker on the sign-ups, or 16 with fewer than 2', () => {
    expect(estimatePlayersStart(0)).toBe(16);
    expect(estimatePlayersStart(1)).toBe(16);
    expect(estimatePlayersStart(2)).toBe(2);
    expect(estimatePlayersStart(12)).toBe(12);
    expect(estimatePlayersStart(40)).toBe(32);
  });
});

describe('step 3 words', () => {
  it('counts the sign-ups', () => {
    expect(signedUpWords(12)).toBe('12 players signed up');
    expect(signedUpWords(1)).toBe('1 player signed up');
    expect(signedUpWords(0)).toBe('0 players signed up');
  });

  it('sums up a bracket, everyone plays everyone, and groups', () => {
    expect(planSummary(fighting, 12)).toBe('1 vs 1 bracket, One life, best of 1, 1 station');
    expect(planSummary({ ...fighting, format: 'double', bestOf: 3, stations: 2 }, 12)).toBe('1 vs 1 bracket, Two lives, best of 3, 2 stations');
    expect(planSummary({ ...fighting, format: 'round_robin' }, 6)).toBe('Everyone plays everyone, best of 1, 1 station');
    const racing = planDefaults('racing');
    expect(planSummary(racing, 12)).toBe('Races and free-for-all, 2 rounds before the final, 1 game in each group, 1 station');
    expect(planSummary({ ...racing, rounds: 1, races: 3 }, 12)).toBe('Races and free-for-all, 1 round before the final, 3 games in each group, 1 station');
    expect(planSummary(racing, 4)).toBe('Races and free-for-all, only the final, 1 game in each group, 1 station');
  });
});

describe('samePlan', () => {
  it('compares every choice, the points by value', () => {
    expect(samePlan(fighting, { ...fighting, points: [...fighting.points] })).toBe(true);
    expect(samePlan(fighting, { ...fighting, stations: fighting.stations + 1 })).toBe(false);
    expect(samePlan(fighting, { ...fighting, points: [4, 3, 2, 0] })).toBe(false);
    expect(samePlan(fighting, planDefaults('racing'))).toBe(false);
  });

  it('is the same for two with no plan, and different for one with and one without', () => {
    expect(samePlan(null, null)).toBe(true);
    expect(samePlan(fighting, null)).toBe(false);
    expect(samePlan(null, fighting)).toBe(false);
  });
});

describe('New event while a competition is played', () => {
  it('says what to do first, in a few words', () => {
    expect(newEventBlockedWords('bracket')).toBe('Finish or delete the bracket first.');
    expect(newEventBlockedWords('groups')).toBe('Finish or delete the groups first.');
  });
});
