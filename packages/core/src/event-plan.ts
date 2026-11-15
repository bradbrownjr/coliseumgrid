// The event's plan: the host's settings from the setup wizard (docs/PLAN.md, section 6,
// "The setup wizard"). The server stores it as JSON and checks it with `isEventPlan` at the
// edge; the wizard and the time estimate read it. The competition keeps its own settings,
// sent when it starts, so changing the plan never changes a running bracket.

import { STATIONS_MAX, STATIONS_MIN } from './bracket-seeding.ts';
import { DEFAULT_POINTS, HEAT_RACES_MAX, HEAT_RACES_MIN, HEAT_ROUNDS_DEFAULT, HEAT_ROUNDS_MAX, HEAT_ROUNDS_MIN, isPointsTable } from './heats.ts';
import type { BestOf, BracketFormat, RacesPerHeat } from './api.ts';

/** A template only sets defaults (docs/PLAN.md, "The setup wizard"). */
export type PlanTemplate = 'fighting' | 'racing' | 'other';
/** The three cards: 1 vs 1 bracket (`single` or `double`), Everyone plays everyone, Races and free-for-all. */
export type PlanFormat = BracketFormat | 'heats';

export const PLAN_TEMPLATES: readonly PlanTemplate[] = ['fighting', 'racing', 'other'];
export const PLAN_FORMATS: readonly PlanFormat[] = ['single', 'double', 'round_robin', 'heats'];
export const PLAN_BEST_OF: readonly BestOf[] = [1, 3, 5];
/** Minutes for one game, or one race with the racing template. */
export const MINUTES_PER_GAME_CHOICES: readonly number[] = [2, 3, 4, 5, 7, 10, 15];
export const CHANGEOVER_CHOICES: readonly number[] = [0, 2, 4, 6, 8];
/** Waiting for a missing player (docs/PLAN.md, "Waiting for a missing player"). */
export const NO_SHOW_CHOICES: readonly number[] = [3, 5, 10, 15];
export const NO_SHOW_DEFAULT = 5;
/** What the screens use when the event has no plan. */
export const CHANGEOVER_DEFAULT = 4;
export const HOURS_MIN = 1;
export const HOURS_MAX = 6;
export const HOURS_DEFAULT = 3;

/** The plan is flat and its schema is closed: no field outside this list is accepted. */
export interface EventPlan {
  template: PlanTemplate;
  format: PlanFormat;
  bestOf: BestOf;
  /** Games in each group. */
  races: RacesPerHeat;
  /** Qualifying rounds before the final. */
  rounds: number;
  /** Points for 1st to 4th; passes `isPointsTable`. */
  points: number[];
  stations: number;
  minutesPerGame: number;
  changeoverMinutes: number;
  /** The time the host has. */
  hours: number;
  noShowMinutes: number;
}

const PLAN_KEYS: readonly string[] = [
  'template',
  'format',
  'bestOf',
  'races',
  'rounds',
  'points',
  'stations',
  'minutesPerGame',
  'changeoverMinutes',
  'hours',
  'noShowMinutes',
];

/** The card each template starts on. */
const TEMPLATE_FORMAT: Record<PlanTemplate, PlanFormat> = { fighting: 'single', racing: 'heats', other: 'single' };
/** Sources: docs/PLAN.md, "Time estimate". A race is shorter than a game. */
const TEMPLATE_MINUTES: Record<PlanTemplate, number> = { fighting: 5, racing: 4, other: 5 };

/** The template's defaults for every step 2 choice. A new object on each call. */
export function planDefaults(template: PlanTemplate): EventPlan {
  return {
    template,
    format: TEMPLATE_FORMAT[template],
    bestOf: 1,
    races: HEAT_RACES_MIN,
    rounds: HEAT_ROUNDS_DEFAULT,
    points: [...DEFAULT_POINTS],
    stations: STATIONS_MIN,
    minutesPerGame: TEMPLATE_MINUTES[template],
    changeoverMinutes: CHANGEOVER_DEFAULT,
    hours: HOURS_DEFAULT,
    noShowMinutes: NO_SHOW_DEFAULT,
  };
}

const oneOf = (choices: readonly unknown[], value: unknown): boolean => choices.includes(value);
const wholeBetween = (value: unknown, min: number, max: number): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/**
 * True when `value` is a whole plan: every field present and in range, and no other field.
 * The server answers 400 for anything else, so a hand-edited database or a rogue client can't
 * put a bad plan on the page.
 */
export function isEventPlan(value: unknown): value is EventPlan {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const plan = value as { [K in keyof EventPlan]?: unknown };
  const keys = Object.keys(plan);
  if (keys.length !== PLAN_KEYS.length || !PLAN_KEYS.every((key) => keys.includes(key))) return false;
  return (
    oneOf(PLAN_TEMPLATES, plan.template) &&
    oneOf(PLAN_FORMATS, plan.format) &&
    oneOf(PLAN_BEST_OF, plan.bestOf) &&
    wholeBetween(plan.races, HEAT_RACES_MIN, HEAT_RACES_MAX) &&
    wholeBetween(plan.rounds, HEAT_ROUNDS_MIN, HEAT_ROUNDS_MAX) &&
    isPointsTable(plan.points) &&
    wholeBetween(plan.stations, STATIONS_MIN, STATIONS_MAX) &&
    oneOf(MINUTES_PER_GAME_CHOICES, plan.minutesPerGame) &&
    oneOf(CHANGEOVER_CHOICES, plan.changeoverMinutes) &&
    wholeBetween(plan.hours, HOURS_MIN, HOURS_MAX) &&
    oneOf(NO_SHOW_CHOICES, plan.noShowMinutes)
  );
}
