// The words and small calculations behind the host screen's Bracket section. No React in here,
// so tests can call them directly. Tournament words follow docs/DOC-STYLE.md, "Tournament words
// on screen".

import {
  BRACKET_PLAYERS_MAX,
  bracketPlayersMin,
  type BestOf,
  type Bracket,
  type BracketFormat,
  type BracketMatch,
  type BracketSlot,
  type Player,
  type TieNotice,
} from '@coliseumgrid/core';
import { ERROR_WORDS } from '../../api/errors.ts';
import { joinHandles } from '../../handles.ts';

/** "1 station", "3 stations". */
export function stationWords(count: number): string {
  return count === 1 ? '1 station' : `${count} stations`;
}

/** 1 to "1st", 2 to "2nd", 3 to "3rd", 4 to "4th", 11 to "11th", 22 to "22nd". */
export function placeWords(place: number): string {
  const lastTwo = place % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${place}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[place % 10] ?? 'th';
  return `${place}${suffix}`;
}

export { joinHandles };

/** "Tie for 1st: Zap and Kai". */
export function tieWords(tie: Pick<TieNotice, 'place' | 'players'>): string {
  return `Tie for ${placeWords(tie.place)}: ${joinHandles(tie.players)}`;
}

/**
 * How long a match has run, counting up from `calledAt`: "0:42", "12:05", "1:02:05". The
 * server and this screen can disagree by a second or two, so a time in the future reads 0:00.
 * Returns '' when there is no usable time.
 */
export function elapsedText(calledAt: string | null, now: number): string {
  if (calledAt === null) return '';
  const started = Date.parse(calledAt);
  if (Number.isNaN(started)) return '';
  const total = Math.max(0, Math.floor((now - started) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

export interface FormatChoice {
  format: BracketFormat;
  name: string;
  line: string;
}

/** The three formats, as the start dialog shows them (docs/DOC-STYLE.md for the names). */
export const FORMAT_CHOICES: readonly FormatChoice[] = [
  { format: 'single', name: 'One life', line: "Lose one match and you're out." },
  { format: 'double', name: 'Two lives', line: "Lose two matches and you're out." },
  { format: 'round_robin', name: 'Everyone plays everyone', line: 'Every player plays all the others. The most wins takes 1st.' },
];

export function formatName(format: BracketFormat): string {
  return FORMAT_CHOICES.find((choice) => choice.format === format)?.name ?? format;
}

/** What a best-of label means: the first to win more than half the games takes the match. */
export function bestOfWords(bestOf: BestOf): string {
  if (bestOf === 1) return 'One game decides the match.';
  return `First to win ${Math.ceil(bestOf / 2)} games takes the match.`;
}

/** "1 player", "5 players". */
export function playerCountWords(count: number): string {
  return count === 1 ? '1 player' : `${count} players`;
}

/**
 * Why a pick of `count` players can't start a `format` bracket, or null when it can. Checked
 * before sending so the host reads it in plain words; the server checks again.
 */
export function startProblem(format: BracketFormat, count: number): string | null {
  const min = bracketPlayersMin(format);
  if (count > BRACKET_PLAYERS_MAX) return ERROR_WORDS['too-many-players'];
  if (count >= min) return null;
  return format === 'double' ? `Two lives needs at least ${min} players.` : `Pick at least ${min} players.`;
}

/** Where a match sits, in words: "Round 2", "Final", "3rd place match". */
export function matchTitle(match: Pick<BracketMatch, 'side' | 'round'>): string {
  switch (match.side) {
    case 'main':
      return `Round ${match.round}`;
    case 'winners':
      return `Winners, round ${match.round}`;
    case 'losers':
      return `Second chance, round ${match.round}`;
    case 'final':
      return 'Final';
    case 'rematch':
      return 'Rematch for the title';
    case 'third':
      return '3rd place match';
    case 'tie-break':
      return match.round > 1 ? `Tie-break, round ${match.round}` : 'Tie-break';
  }
}

/** A slot as a name: the handle, or why there isn't one yet. */
export function slotWords(slot: BracketSlot): string {
  if (slot.player) return slot.player.handle;
  return slot.bye ? 'Nobody' : 'To be decided';
}

/** "Zap vs Kai", or "Zap" with the bye words when the other side is empty. */
export function matchWords(match: Pick<BracketMatch, 'slots'>): string {
  const [first, second] = match.slots;
  const bye = first.bye ? second : second.bye ? first : null;
  if (bye?.player) return `${bye.player.handle}: Moves on this round`;
  return `${slotWords(first)} vs ${slotWords(second)}`;
}

/** The player who moves on in a bye match, or null if the match is not a bye. */
export function byePlayer(match: BracketMatch): Player | null {
  if (match.status !== 'bye') return null;
  return match.slots[0].player ?? match.slots[1].player;
}

/** "Zap beat Kai" for a done match; null before a result. */
export function resultWords(match: BracketMatch): string | null {
  if (match.winner === null) return null;
  const winner = match.slots[match.winner].player;
  const loser = match.slots[match.winner === 0 ? 1 : 0].player;
  if (!winner || !loser) return null;
  return `${winner.handle} beat ${loser.handle}`;
}

/** The ids of every player in the bracket, for "Add to bracket" on the players still out. */
export function playersInBracket(bracket: Bracket): Set<number> {
  const ids = new Set<number>();
  const add = (match: BracketMatch | null) => {
    for (const slot of match?.slots ?? []) if (slot.player) ids.add(slot.player.id);
  };
  for (const match of bracket.matches) add(match);
  for (const match of bracket.upNext) add(match);
  for (const station of bracket.stations) add(station.match);
  for (const row of bracket.standings) ids.add(row.player.id);
  return ids;
}

/** Done matches, newest result first. `resultId` grows with each result. */
export function doneMatches(bracket: Bracket): BracketMatch[] {
  return bracket.matches
    .filter((match) => match.status === 'done' && match.resultId !== null)
    .sort((a, b) => (b.resultId ?? 0) - (a.resultId ?? 0));
}

/** Handles in alphabetical order, ignoring case. */
export function byHandle(a: Pick<Player, 'handle'>, b: Pick<Player, 'handle'>): number {
  return a.handle.localeCompare(b.handle, undefined, { sensitivity: 'base' });
}
