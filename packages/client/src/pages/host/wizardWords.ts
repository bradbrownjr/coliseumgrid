// The words and small calculations behind the setup wizard (docs/PLAN.md, "The setup wizard"
// and "Time estimate"; docs/DESIGN.md, "Setup wizard"). No React in here, so tests can call
// them directly. Tournament words follow docs/DOC-STYLE.md, "Tournament words on screen".

import {
  FINAL_SIZE,
  HEAT_SIZE_MAX,
  displayMinutes,
  hasQualifying,
  planDefaults,
  type Estimate,
  type EventPlan,
  type FixId,
  type PlanFormat,
  type PlanTemplate,
} from '@coliseumgrid/core';
import { FORMAT_CHOICES, formatName, playerCountWords, stationWords } from './bracketWords.ts';
import { gameCount } from './groupWords.ts';

/** The Stepper's labels, in order. */
export const STEP_LABELS = ['Name and game', 'How to play', 'Start'] as const;

/** The line step 1 shows in new-event mode. */
export const NEW_EVENT_WORDS = 'Players sign up again for this event.';

/** A radio card: the value it picks, its bold name, and its line. */
export interface Choice<T extends string> {
  value: T;
  name: string;
  line: string;
}

// Step 1 ---------------------------------------------------------------------------------

export const TEMPLATE_NAMES: Record<PlanTemplate, string> = {
  fighting: 'Fighting game',
  racing: 'Racing game',
  other: 'Another game',
};

/** "game", or "race" with the racing template: what one of the minutes is for. */
export const gameWord = (template: PlanTemplate): string => (template === 'racing' ? 'race' : 'game');

/** The template card's line, built from the template's own defaults: "1 vs 1 bracket, 5 minutes a game." */
export function templateLine(template: PlanTemplate): string {
  const defaults = planDefaults(template);
  return `${cardName(defaults.format)}, ${defaults.minutesPerGame} minutes a ${gameWord(template)}.`;
}

/**
 * The plan after the host taps a template card. The same template keeps the plan. Another one
 * puts its defaults over every step 2 choice, so step 2 never shows a half-old plan; going back
 * to the saved template brings the saved plan back.
 */
export function withTemplate(plan: EventPlan, template: PlanTemplate, saved: EventPlan | null): EventPlan {
  if (plan.template === template) return plan;
  if (saved?.template === template) return saved;
  return planDefaults(template);
}

// Step 2 ---------------------------------------------------------------------------------

/** The three format cards. "1 vs 1 bracket" covers One life and Two lives, picked under "More options". */
export type Card = 'bracket' | 'round_robin' | 'heats';

export const cardOf = (format: PlanFormat): Card => (format === 'single' || format === 'double' ? 'bracket' : format);

const ROUND_ROBIN_LINE = FORMAT_CHOICES.find((choice) => choice.format === 'round_robin')?.line ?? '';

export const CARD_CHOICES: readonly Choice<Card>[] = [
  { value: 'bracket', name: '1 vs 1 bracket', line: 'Players face off one on one. Winners move on.' },
  { value: 'round_robin', name: 'Everyone plays everyone', line: ROUND_ROBIN_LINE },
  {
    value: 'heats',
    name: 'Races and free-for-all',
    line: `Groups of up to ${HEAT_SIZE_MAX} score points by place. The top ${FINAL_SIZE} play a final.`,
  },
];

export function cardName(format: PlanFormat): string {
  return CARD_CHOICES.find((choice) => choice.value === cardOf(format))?.name ?? format;
}

/** The template cards. Made after the format cards, whose names their lines use. */
export const TEMPLATE_CHOICES: readonly Choice<PlanTemplate>[] = (['fighting', 'racing', 'other'] as const).map((template) => ({
  value: template,
  name: TEMPLATE_NAMES[template],
  line: templateLine(template),
}));

/** The plan with a card picked. The bracket card starts on One life; the card already picked changes nothing. */
export function withCard(plan: EventPlan, card: Card): EventPlan {
  if (cardOf(plan.format) === card) return plan;
  return { ...plan, format: card === 'bracket' ? 'single' : card };
}

/** The players count the estimate starts on: the number signed up when that is 2 or more, else 16. */
export const ESTIMATE_PLAYERS_DEFAULT = 16;
export const ESTIMATE_PLAYERS_MIN = 2;
export const ESTIMATE_PLAYERS_MAX = 32;

export function estimatePlayersStart(signedUp: number): number {
  return signedUp >= ESTIMATE_PLAYERS_MIN ? Math.min(signedUp, ESTIMATE_PLAYERS_MAX) : ESTIMATE_PLAYERS_DEFAULT;
}

/** "1 hour", "3 hours". */
export function hoursWords(hours: number): string {
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

/** "1 minute", "5 minutes". */
export function minutesWords(minutes: number): string {
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * A length of time as the screen shows it: the nearest 5 minutes under an hour and the nearest
 * 15 from an hour (`displayMinutes`). "45 minutes", "2 hours", "2 hours 15 minutes".
 */
export function durationWords(minutes: number): string {
  const shown = displayMinutes(minutes);
  const hours = Math.floor(shown / 60);
  const rest = shown % 60;
  if (hours === 0) return minutesWords(rest);
  return rest === 0 ? hoursWords(hours) : `${hoursWords(hours)} ${minutesWords(rest)}`;
}

/** "About 2 hours 15 minutes": the high end, which is what the screen shows. */
export function aboutWords(estimate: Estimate): string {
  return `About ${durationWords(estimate.minutes.high)}`;
}

/** The words after the players picker: "players, this takes about 2 hours". */
export function estimateTail(players: number, estimate: Estimate): string {
  return `${players === 1 ? 'player' : 'players'}, this takes about ${durationWords(estimate.minutes.high)}`;
}

/** "With 16 players, this takes about 2 hours". */
export function estimateWords(players: number, estimate: Estimate): string {
  return `With ${players} ${estimateTail(players, estimate)}`;
}

/**
 * "Done around 8:15 PM": now plus the shown high end, in the laptop's own clock format
 * (`Intl.DateTimeFormat`, nothing from the network). `locale` and `timeZone` are for tests.
 */
export function finishWords(estimate: Estimate, now: number, locale?: string, timeZone?: string): string {
  const done = new Date(now + displayMinutes(estimate.minutes.high) * 60_000);
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', ...(timeZone && { timeZone }) }).format(done);
  return `Done around ${clock}`;
}

/** The too-long warning. */
export function tooLongWords(hours: number): string {
  return `That is longer than the ${hoursWords(hours)} you have.`;
}

/** The fix buttons under the warning. Each applies its change at once. */
export const FIX_WORDS: Record<FixId, string> = {
  station: 'Add a station',
  'one-life': 'Pick One life',
  'best-of-1': 'Play best of 1',
  bracket: 'Pick 1 vs 1 bracket',
  'fewer-games': 'Play fewer games in each group',
  'one-round': 'Play 1 round before the final',
};

/** The label of the minutes setting: a race is shorter than a game (docs/PLAN.md, "Time estimate"). */
export function minutesLabel(template: PlanTemplate): string {
  return `Minutes for one ${gameWord(template)}`;
}

// Step 3 ---------------------------------------------------------------------------------

/** "12 players signed up". */
export function signedUpWords(count: number): string {
  return `${playerCountWords(count)} signed up`;
}

/**
 * The choices in one line: "1 vs 1 bracket, One life, best of 1, 1 station", or for groups
 * "Races and free-for-all, 2 rounds before the final, 1 game in each group, 1 station". With 2
 * to 4 players, groups have only the final.
 */
export function planSummary(plan: EventPlan, players: number): string {
  const stations = stationWords(plan.stations);
  if (plan.format === 'heats') {
    const rounds = hasQualifying(players) ? `${plan.rounds === 1 ? '1 round' : `${plan.rounds} rounds`} before the final` : 'only the final';
    return `${cardName(plan.format)}, ${rounds}, ${gameCount(plan.races)} in each group, ${stations}`;
  }
  const lives = plan.format === 'round_robin' ? '' : `${formatName(plan.format)}, `;
  return `${cardName(plan.format)}, ${lives}best of ${plan.bestOf}, ${stations}`;
}
