// Catchy event names for the dice button in the setup wizard (docs/PLAN.md, section 6, "The
// setup wizard"). A name is two words ("Thunder Showdown"), a short phrase ("Turbo Grand
// Prix"), or a compound ("Stormfest"), built from plain, kid-friendly word lists that match
// the template. The caller passes a seeded `RandomSource` (CLAUDE.md, rule 4); the host page
// seeds one from `crypto.getRandomValues` on each tap.
//
// The lists hold no game titles, game companies, brand names, or trademarks (CLAUDE.md,
// "Always and never", Brad, 2026-11-14), so a word that is the defining word of a well known
// game stays out even when it is an ordinary word. test/event-names.test.ts runs every name
// the lists can make through `isVulgar`, as written and with the spaces taken out, because a
// rude word can span the join.

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
  'Sunny', 'Supreme', 'Turbo', 'Ultra', 'Wicked', 'Wonder', 'Zany', 'Electric', 'Frosty', 'Rocket',
  'Thunder', 'Cyber', 'Mystic', 'Royal', 'Stellar', 'Awesome', 'Blazing', 'Crazy',
] as const;

const GENERAL_SECOND = [
  'Showdown', 'Championship', 'Tournament', 'Challenge', 'Classic', 'Cup', 'Bash', 'Fiesta', 'Festival', 'Frenzy',
  'Invitational', 'Open', 'Games', 'Trophy', 'Rally', 'Throwdown', 'Faceoff', 'Gauntlet', 'Quest', 'Arena',
  'Jubilee', 'Spectacular', 'Mashup', 'Marathon', 'Shootout', 'Summit', 'Cup Night', 'Game Night', 'Play-off', 'Rumpus',
  'Carnival', 'Bonanza', 'Extravaganza', 'Roundup', 'Contest', 'Duel', 'Standoff', 'Face Off', 'Blowout', 'Grand Finale',
] as const;

const GENERAL_STARTS = [
  'Thunder', 'Storm', 'Blaze', 'Comet', 'Rocket', 'Turbo', 'Lightning', 'Star', 'Sky', 'Fire',
  'Mega', 'Hyper', 'Power', 'Pixel', 'Neon', 'Cosmo', 'Galaxy', 'Wonder', 'Victory', 'Champ',
  'Hero', 'Dragon', 'Tiger', 'Falcon', 'Wolf', 'Frost', 'Spark', 'Ultra', 'Super', 'Zap',
  'Jungle', 'Ocean', 'Mountain', 'Canyon', 'Meteor', 'Solar', 'Lunar', 'Atomic', 'Rapid', 'Giga',
] as const;

const GENERAL_ENDS = ['fest', 'palooza', 'rama', 'zone', 'mania', 'blast', 'burst', 'bowl', 'quest', 'rush', 'storm', 'splash'] as const;

const FIGHTING_FIRST = [
  'Thunder', 'Iron', 'Steel', 'Fierce', 'Mighty', 'Savage', 'Furious', 'Crimson', 'Shadow', 'Blazing',
  'Fearless', 'Legendary', 'Knockout', 'Rumbling', 'Champion', 'Warrior', 'Titan', 'Dragon', 'Phoenix',
  'Lightning', 'Raging', 'Bold', 'Brave', 'Daring', 'Heroic', 'Atomic', 'Cosmic', 'Stone', 'Fist',
  'Ninja', 'Samurai', 'Viking', 'Gladiator', 'Rogue', 'Fury', 'Dynamite', 'Turbo', 'Mega', 'Wild',
  'Golden', 'Final', 'Ironclad', 'Grand', 'Hammer', 'Tiger', 'Falcon', 'Wolf',
] as const;

const FIGHTING_SECOND = [
  'Showdown', 'Throwdown', 'Rumble', 'Faceoff', 'Duel', 'Gauntlet', 'Arena', 'Bash', 'Battle', 'Bout',
  'Tournament', 'Championship', 'Cup', 'Invitational', 'Challenge', 'Standoff', 'Takedown', 'Shootout', 'Skirmish', 'Scuffle',
  'Slugfest', 'Power Hour', 'Rematch Night', 'Knockout', 'Dojo', 'Open', 'Classic', 'Trophy', 'Fist Fest', 'Grand Finale',
  'Free-for-all', 'Face Off', 'Tussle', 'Contest', 'Blowout', 'Underdog Cup', 'Combat Cup', 'Battle Royal', 'Round Up', 'Grudge Match',
] as const;

const FIGHTING_STARTS = [
  'Thunder', 'Iron', 'Steel', 'Storm', 'Blaze', 'Shadow', 'Dragon', 'Phoenix', 'Lightning', 'Fire',
  'Fist', 'Titan', 'Viking', 'Ninja', 'Samurai', 'Gladiator', 'Hammer', 'Tiger', 'Falcon', 'Wolf',
  'Atomic', 'Cosmic', 'Crimson', 'Furious', 'Knockout', 'Rumble', 'Warrior', 'Champ', 'Hero', 'Spark',
  'Frost', 'Stone', 'Comet', 'Meteor', 'Mega', 'Hyper', 'Power', 'Turbo', 'Rogue', 'Dynamite',
] as const;

const FIGHTING_ENDS = ['fest', 'palooza', 'rama', 'zone', 'mania', 'blast', 'burst', 'bowl', 'down', 'storm', 'slam', 'rush'] as const;

const RACING_FIRST = [
  'Turbo', 'Nitro', 'Rocket', 'Neon', 'Supersonic', 'Lightning', 'Thunder', 'Blazing', 'Rapid', 'Velocity',
  'Hyper', 'Mega', 'Ultra', 'Cosmic', 'Golden', 'Silver', 'Crimson', 'Midnight', 'Sunset', 'Desert',
  'Jungle', 'Canyon', 'Coastal', 'Mountain', 'Frosty', 'Electric', 'Atomic', 'Comet', 'Meteor', 'Dusty',
  'Sunny', 'Fearless', 'Daring', 'Champion', 'Grand', 'Royal', 'Mighty', 'Zippy', 'Wild', 'Speedy',
  'Flying', 'Rolling', 'Twisty', 'Bumpy', 'Rainy', 'Starlight', 'Moonlight', 'Checkered',
] as const;

const RACING_SECOND = [
  'Grand Prix', 'Rally', 'Dash', 'Derby', 'Cup', 'Circuit', 'Speedway', 'Sprint', 'Showdown', 'Challenge',
  'Invitational', 'Trophy', 'Classic', 'Rush', 'Slipstream', 'Gauntlet', 'Raceway', 'Run', 'Open', 'Championship',
  'Cup Race', 'Time Trial', 'Relay', 'Marathon', 'Scramble', 'Chase', 'Drift Cup', 'Pit Stop', 'Finish Line', 'Starting Grid',
  'Road Rally', 'Fast Lane', 'Victory Lap', 'Full Throttle', 'Rally Cup', 'Tune Up', 'Dust Up', 'Drag Day', 'Grand Tour', 'Turbo Cup',
] as const;

const RACING_STARTS = [
  'Turbo', 'Nitro', 'Rocket', 'Neon', 'Lightning', 'Thunder', 'Blaze', 'Comet', 'Meteor', 'Storm',
  'Hyper', 'Mega', 'Ultra', 'Super', 'Zoom', 'Zip', 'Velocity', 'Sprint', 'Dash', 'Rally',
  'Desert', 'Canyon', 'Coast', 'Summit', 'Jungle', 'Frost', 'Spark', 'Flame', 'Atomic', 'Cosmo',
  'Sunset', 'Midnight', 'Starlight', 'Moonlight', 'Champ', 'Victory', 'Checker', 'Pit', 'Slip', 'Rapid',
] as const;

const RACING_ENDS = ['fest', 'palooza', 'rama', 'zone', 'mania', 'blast', 'burst', 'bowl', 'dash', 'rush', 'storm', 'splash'] as const;

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
