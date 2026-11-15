// Catchy event names for the dice button in the setup wizard (docs/PLAN.md, section 6, "The
// setup wizard"). A name is two words ("Thunder Showdown"), a short phrase ("Turbo Grand
// Prix"), or a compound ("Stormfest"), built from plain, kid-friendly word lists that match
// the template. The caller passes a seeded `RandomSource` (CLAUDE.md, rule 4); the host page
// seeds one from `crypto.getRandomValues` on each tap.
//
// The lists hold no game titles, game companies, brand names, sports leagues, or trademarks
// (CLAUDE.md, "Always and never", Brad, 2026-11-14). A word that is the defining word of a
// well known title stays out even when it is an ordinary word, and so does an ending that
// turns a common word into one (the lists read every pairing, not only each word alone).
// No word may appear twice in one name. test/event-names.test.ts runs every name the lists can
// make through `isVulgar`, as written and with the spaces taken out, because a rude word can
// span the join.

import type { PlanTemplate } from './event-plan.ts';
import type { RandomSource } from './random.ts';

/** The longest name the event name box takes (`cleanEventName` on the server). */
export const EVENT_NAME_MAX = 60;

interface WordLists {
  /** First words: describe the event. */
  first: readonly string[];
  /** Second words, or short phrases, that follow a first word after a space. */
  second: readonly string[];
  /** Words that start a compound, and the endings that finish one, joined with no space. */
  starts: readonly string[];
  ends: readonly string[];
}

const GENERAL_FIRST = [
  'Epic', 'Mega', 'Grand', 'Mighty', 'Super', 'Wild', 'Cosmic', 'Golden', 'Silver', 'Lucky',
  'Rapid', 'Bright', 'Bold', 'Brave', 'Daring', 'Fearless', 'Funky', 'Giant', 'Great', 'Heroic',
  'Jolly', 'Legendary', 'Magic', 'Neon', 'Ninja', 'Pixel', 'Radical', 'Savage', 'Secret', 'Shiny',
  'Sunny', 'Turbo', 'Wicked', 'Wonder', 'Zany', 'Electric', 'Frosty', 'Rocket', 'Thunder', 'Cyber',
  'Mystic', 'Royal', 'Stellar', 'Awesome', 'Blazing', 'Crazy', 'Fabulous', 'Splendid',
] as const;

const GENERAL_SECOND = [
  'Showdown', 'Championship', 'Tournament', 'Challenge', 'Classic', 'Cup', 'Bash', 'Fiesta', 'Festival', 'Frenzy',
  'Invitational', 'Open', 'Trophy', 'Rally', 'Throwdown', 'Faceoff', 'Gauntlet', 'Clash', 'Showcase', 'Jubilee',
  'Spectacular', 'Mashup', 'Marathon', 'Shootout', 'Summit', 'Cup Night', 'Game Night', 'Play-off', 'Rumpus', 'Carnival',
  'Bonanza', 'Extravaganza', 'Roundup', 'Contest', 'Duel', 'Standoff', 'Face Off', 'Blowout', 'Finale', 'Party',
] as const;

const GENERAL_STARTS = [
  'Thunder', 'Storm', 'Blaze', 'Comet', 'Rocket', 'Turbo', 'Lightning', 'Glow', 'Sky', 'Fire',
  'Mega', 'Hyper', 'Power', 'Pixel', 'Neon', 'Orbit', 'Aurora', 'Wonder', 'Victory', 'Champ',
  'Hero', 'Dragon', 'Tiger', 'Falcon', 'Wolf', 'Frost', 'Spark', 'Super', 'Zap', 'Jungle',
  'Ocean', 'Mountain', 'Canyon', 'Meteor', 'Solar', 'Lunar', 'Atomic', 'Rapid', 'Giga', 'Cobalt',
] as const;

const GENERAL_ENDS = ['fest', 'palooza', 'blast', 'rush', 'splash', 'athon', 'tastic', 'clash', 'bash'] as const;

const FIGHTING_FIRST = [
  'Thunder', 'Iron', 'Steel', 'Fierce', 'Mighty', 'Savage', 'Furious', 'Crimson', 'Shadow', 'Blazing',
  'Fearless', 'Legendary', 'Knockout', 'Rumbling', 'Champion', 'Warrior', 'Titan', 'Dragon', 'Phoenix',
  'Lightning', 'Raging', 'Bold', 'Brave', 'Daring', 'Heroic', 'Atomic', 'Cosmic', 'Stone', 'Fist',
  'Ninja', 'Viking', 'Gladiator', 'Rogue', 'Fury', 'Dynamite', 'Turbo', 'Mega', 'Wild', 'Golden',
  'Grand', 'Hammer', 'Tiger', 'Falcon', 'Wolf', 'Epic', 'Ultimate', 'Unstoppable',
] as const;

const FIGHTING_SECOND = [
  'Showdown', 'Throwdown', 'Rumble', 'Faceoff', 'Duel', 'Gauntlet', 'Clash', 'Bash', 'Battle', 'Bout',
  'Tournament', 'Championship', 'Cup', 'Invitational', 'Challenge', 'Standoff', 'Takedown', 'Shootout', 'Skirmish', 'Scuffle',
  'Slugfest', 'Power Hour', 'Rematch Night', 'Dojo', 'Open', 'Classic', 'Trophy', 'Finale', 'Free-for-all', 'Face Off',
  'Tussle', 'Contest', 'Blowout', 'Underdog Cup', 'Combat Cup', 'Battle Royal', 'Round Up', 'Sparring Night', 'Grudge Cup', 'Underdog Open',
] as const;

const FIGHTING_STARTS = [
  'Thunder', 'Iron', 'Steel', 'Storm', 'Blaze', 'Shadow', 'Dragon', 'Boulder', 'Lightning', 'Fire',
  'Fist', 'Titan', 'Viking', 'Ninja', 'Gladiator', 'Hammer', 'Tiger', 'Falcon', 'Wolf', 'Atomic',
  'Cosmic', 'Crimson', 'Furious', 'Knockout', 'Rumble', 'Warrior', 'Champ', 'Hero', 'Spark', 'Frost',
  'Stone', 'Comet', 'Meteor', 'Mega', 'Hyper', 'Power', 'Turbo', 'Rogue', 'Dynamite', 'Cobalt',
] as const;

const FIGHTING_ENDS = ['fest', 'palooza', 'blast', 'down', 'slam', 'rush', 'athon', 'tastic', 'clash', 'bash'] as const;

const RACING_FIRST = [
  'Turbo', 'Nitro', 'Rocket', 'Neon', 'Lightning', 'Thunder', 'Blazing', 'Rapid', 'Velocity', 'Hyper',
  'Mega', 'Ultra', 'Cosmic', 'Golden', 'Silver', 'Crimson', 'Sunset', 'Desert', 'Jungle', 'Canyon',
  'Coastal', 'Mountain', 'Frosty', 'Electric', 'Atomic', 'Comet', 'Meteor', 'Dusty', 'Sunny', 'Fearless',
  'Daring', 'Champion', 'Royal', 'Mighty', 'Zippy', 'Wild', 'Speedy', 'Flying', 'Rolling', 'Twisty',
  'Bumpy', 'Rainy', 'Starlight', 'Moonlight', 'Checkered', 'Breezy', 'Zooming', 'Roaring',
] as const;

const RACING_SECOND = [
  'Grand Prix', 'Rally', 'Dash', 'Derby', 'Cup', 'Circuit', 'Speedway', 'Sprint', 'Showdown', 'Challenge',
  'Invitational', 'Trophy', 'Classic', 'Rush', 'Slipstream', 'Gauntlet', 'Raceway', 'Run', 'Open', 'Championship',
  'Cup Race', 'Time Trial', 'Relay', 'Marathon', 'Scramble', 'Chase', 'Drift Cup', 'Pit Stop', 'Finish Line', 'Starting Grid',
  'Road Rally', 'Fast Lane', 'Victory Lap', 'Race Day', 'Rally Cup', 'Tune Up', 'Dust Up', 'Drag Day', 'Lap Party', 'Time Attack',
] as const;

const RACING_STARTS = [
  'Turbo', 'Nitro', 'Rocket', 'Neon', 'Lightning', 'Thunder', 'Blaze', 'Comet', 'Meteor', 'Storm',
  'Hyper', 'Mega', 'Super', 'Zoom', 'Zip', 'Velocity', 'Sprint', 'Rally', 'Desert', 'Canyon',
  'Coast', 'Summit', 'Jungle', 'Frost', 'Spark', 'Flame', 'Atomic', 'Orbit', 'Sunset', 'Starlight',
  'Moonlight', 'Champ', 'Victory', 'Checker', 'Pit', 'Slip', 'Rapid', 'Aurora', 'Cobalt', 'Breeze',
] as const;

const RACING_ENDS = ['fest', 'palooza', 'blast', 'rush', 'splash', 'dash', 'athon', 'tastic', 'drift'] as const;

const WORDS: Record<PlanTemplate, WordLists> = {
  fighting: { first: FIGHTING_FIRST, second: FIGHTING_SECOND, starts: FIGHTING_STARTS, ends: FIGHTING_ENDS },
  racing: { first: RACING_FIRST, second: RACING_SECOND, starts: RACING_STARTS, ends: RACING_ENDS },
  other: { first: GENERAL_FIRST, second: GENERAL_SECOND, starts: GENERAL_STARTS, ends: GENERAL_ENDS },
};

const pick = <T>(items: readonly T[], random: RandomSource): T => items[Math.floor(random() * items.length)] as T;

/** A compound is the start, then the ending in lowercase: "Thunder" and "fest" make "Thunderfest". */
const compound = (start: string, end: string): string => `${start}${end}`;

/**
 * A name for the template: about 2 in 3 are two words or a short phrase, the rest a
 * compound. Always `EVENT_NAME_MAX` characters or fewer.
 */
export function eventName(template: PlanTemplate, random: RandomSource): string {
  const words = WORDS[template];
  // Draw the pattern first so the same seed gives the same name whatever the lists hold.
  if (random() < 2 / 3) return `${pick(words.first, random)} ${pick(words.second, random)}`;
  return compound(pick(words.starts, random), pick(words.ends, random));
}

/** Every name `eventName` can make for the template. For tests; the page only uses `eventName`. */
export function allEventNames(template: PlanTemplate): string[] {
  const words = WORDS[template];
  const names = new Set<string>();
  for (const first of words.first) for (const second of words.second) names.add(`${first} ${second}`);
  for (const start of words.starts) for (const end of words.ends) names.add(compound(start, end));
  return [...names];
}
