import { describe, expect, it } from 'vitest';
import {
  CHANGEOVER_CHOICES,
  DEFAULT_POINTS,
  HOURS_MAX,
  HOURS_MIN,
  MINUTES_PER_GAME_CHOICES,
  NO_SHOW_CHOICES,
  PLAN_FORMATS,
  PLAN_TEMPLATES,
  STATIONS_MAX,
  STATIONS_MIN,
  isEventPlan,
  isPointsTable,
  planDefaults,
  type EventPlan,
} from '../src/index.ts';

describe('planDefaults', () => {
  it.each([
    ['fighting', 'single', 5],
    ['racing', 'heats', 4],
    ['other', 'single', 5],
  ] as const)('%s starts on %s with %i minutes for one game', (template, format, minutes) => {
    const plan = planDefaults(template);
    expect(plan.template).toBe(template);
    expect(plan.format).toBe(format);
    expect(plan.minutesPerGame).toBe(minutes);
  });

  it.each(PLAN_TEMPLATES)('%s has the dialog defaults and passes isEventPlan', (template) => {
    const plan = planDefaults(template);
    expect(plan).toMatchObject({ bestOf: 1, races: 1, rounds: 2, stations: 1, changeoverMinutes: 4, hours: 3, noShowMinutes: 5 });
    expect(plan.points).toEqual([4, 3, 2, 1]);
    expect(isEventPlan(plan)).toBe(true);
  });

  it('gives a new object each time, so changing one plan never changes the defaults', () => {
    const a = planDefaults('fighting');
    a.points[0] = 9;
    a.stations = 4;
    expect(planDefaults('fighting').points).toEqual([...DEFAULT_POINTS]);
    expect(planDefaults('fighting').stations).toBe(1);
  });
});

describe('isEventPlan', () => {
  const base = (): EventPlan => planDefaults('fighting');
  const bad = (patch: Record<string, unknown>): unknown => ({ ...base(), ...patch });

  it('accepts every choice in every list', () => {
    for (const template of PLAN_TEMPLATES) expect(isEventPlan({ ...base(), template })).toBe(true);
    for (const format of PLAN_FORMATS) expect(isEventPlan({ ...base(), format })).toBe(true);
    for (const bestOf of [1, 3, 5]) expect(isEventPlan({ ...base(), bestOf })).toBe(true);
    for (const races of [1, 2, 3, 4]) expect(isEventPlan({ ...base(), races })).toBe(true);
    for (const rounds of [1, 2, 3]) expect(isEventPlan({ ...base(), rounds })).toBe(true);
    for (let stations = STATIONS_MIN; stations <= STATIONS_MAX; stations++) expect(isEventPlan({ ...base(), stations })).toBe(true);
    for (const minutesPerGame of MINUTES_PER_GAME_CHOICES) expect(isEventPlan({ ...base(), minutesPerGame })).toBe(true);
    for (const changeoverMinutes of CHANGEOVER_CHOICES) expect(isEventPlan({ ...base(), changeoverMinutes })).toBe(true);
    for (let hours = HOURS_MIN; hours <= HOURS_MAX; hours++) expect(isEventPlan({ ...base(), hours })).toBe(true);
    for (const noShowMinutes of NO_SHOW_CHOICES) expect(isEventPlan({ ...base(), noShowMinutes })).toBe(true);
  });

  it.each([
    ['an unknown template', { template: 'sports' }],
    ['an unknown format', { format: 'swiss' }],
    ['best of 2', { bestOf: 2 }],
    ['0 races', { races: 0 }],
    ['5 races', { races: 5 }],
    ['0 rounds', { rounds: 0 }],
    ['4 rounds', { rounds: 4 }],
    ['1.5 rounds', { rounds: 1.5 }],
    ['0 stations', { stations: 0 }],
    ['9 stations', { stations: 9 }],
    ['a station count as text', { stations: '2' }],
    ['6 minutes for a game', { minutesPerGame: 6 }],
    ['1 changeover minute', { changeoverMinutes: 1 }],
    ['0 hours', { hours: 0 }],
    ['7 hours', { hours: 7 }],
    ['2.5 hours', { hours: 2.5 }],
    ['a 4 minute wait', { noShowMinutes: 4 }],
    ['a points table that rises', { points: [1, 2, 3, 4] }],
    ['a points table of 3', { points: [3, 2, 1] }],
    ['1st worth 0', { points: [0, 0, 0, 0] }],
    ['NaN hours', { hours: Number.NaN }],
    ['Infinity stations', { stations: Number.POSITIVE_INFINITY }],
  ])('refuses %s', (_label, patch) => {
    expect(isEventPlan(bad(patch))).toBe(false);
  });

  it('refuses a missing field, an extra field, and something that is not an object', () => {
    for (const key of Object.keys(base())) {
      const { [key as keyof EventPlan]: _removed, ...rest } = base();
      expect(isEventPlan(rest), key).toBe(false);
    }
    expect(isEventPlan({ ...base(), extra: 1 })).toBe(false);
    for (const value of [null, undefined, 'plan', 5, [], [base()]]) expect(isEventPlan(value)).toBe(false);
  });

  it('uses the points table check of heats', () => {
    for (const points of [[4, 3, 2, 1], [20, 20, 20, 20], [1, 0, 0, 0]]) {
      expect(isPointsTable(points)).toBe(true);
      expect(isEventPlan({ ...base(), points })).toBe(true);
    }
    expect(isEventPlan({ ...base(), points: [21, 3, 2, 1] })).toBe(false);
  });
});
