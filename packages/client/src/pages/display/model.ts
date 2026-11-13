// What the Display draws, worked out from a Bracket answer (docs/PLAN.md, "Brackets API")
// or a Heats answer ("Heats API"). Pure functions with no React, so the choices (which rounds, which sections, how big) are
// tested without a screen.

import type {
  Bracket,
  BracketMatch,
  BracketSlot,
  BracketStation,
  Heat,
  HeatStation,
  Heats,
  Player,
  StandingsRow,
  TieNotice,
} from '@coliseumgrid/core';

/** The earliest unfinished round and the two after it, so 32 players stay readable. */
export const SHOWN_ROUNDS = 3;
/** A round with more matches than this wraps into a second column, so its cards stay large. */
export const MAX_PER_COLUMN = 8;
export const UP_NEXT_COUNT = 3;
/** A standings table with more rows than this splits into two side by side. */
export const MAX_TABLE_ROWS = 16;

/** The MUI typography variants the TV uses, largest first. */
export const TYPE_LADDER = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'subtitle1', 'body1', 'body2'] as const;
export type TypeVariant = (typeof TYPE_LADDER)[number];

/** `variant` moved `steps` down the ladder, stopping at the smallest. */
export function stepDown(variant: TypeVariant, steps: number): TypeVariant {
  const index = Math.min(TYPE_LADDER.indexOf(variant) + steps, TYPE_LADDER.length - 1);
  return TYPE_LADDER[index] ?? 'body2';
}

/**
 * The type for a TV size and the smaller screens below it. A phone shows h6 at most (the page
 * stacks there), a tablet and a laptop sit one or two steps under the TV size.
 */
export function scaleType(variant: TypeVariant): Record<'xs' | 'md' | 'lg' | 'xl', TypeVariant> {
  const phone = TYPE_LADDER.indexOf(variant) >= TYPE_LADDER.indexOf('h6') ? variant : 'h6';
  return { xs: phone, md: stepDown(variant, 2), lg: stepDown(variant, 1), xl: variant };
}

// ---------------------------------------------------------------------------------------
// Rounds and sections

/** A match with a result or a bye needs nothing more. */
export const isFinished = (match: BracketMatch): boolean => match.status === 'done' || match.status === 'bye';

/** A bye match with nobody in it (a double elimination corner) has nothing to draw. */
export const isShown = (match: BracketMatch): boolean =>
  !(match.status === 'bye' && match.slots.every((slot) => slot.player === null));

/**
 * The rounds to draw for one side of a bracket: the earliest round with an unfinished match
 * and the two after it. When every round is finished, the last one.
 */
export function windowRounds(matches: BracketMatch[]): number[] {
  const rounds = [...new Set(matches.map((match) => match.round))].sort((a, b) => a - b);
  const first = rounds.find((round) => matches.some((match) => match.round === round && !isFinished(match)));
  if (first === undefined) return rounds.slice(-1);
  const start = rounds.indexOf(first);
  return rounds.slice(start, start + SHOWN_ROUNDS);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface DisplayColumn {
  key: string;
  /** Null when the section's title already says it. */
  heading: string | null;
  /** The round's matches in order, wrapped into columns of at most MAX_PER_COLUMN. */
  chunks: BracketMatch[][];
  /** Single elimination's 3rd-place match, drawn under the final. */
  extra?: { heading: string; match: BracketMatch };
}

export interface DisplaySection {
  key: string;
  title: string | null;
  columns: DisplayColumn[];
}

/** In single elimination the last two rounds have names a kid knows; the rest are numbered. */
export function singleRoundName(round: number, lastRound: number): string {
  if (round === lastRound) return 'Final';
  if (round === lastRound - 1) return 'Semi-finals';
  return `Round ${round}`;
}

function roundColumns(
  matches: BracketMatch[],
  name: (round: number, lastRound: number) => string | null,
): DisplayColumn[] {
  const lastRound = Math.max(0, ...matches.map((match) => match.round));
  return windowRounds(matches).map((round) => ({
    key: `round-${round}`,
    heading: name(round, lastRound),
    chunks: chunk(
      matches.filter((match) => match.round === round).sort((a, b) => a.number - b.number),
      MAX_PER_COLUMN,
    ),
  }));
}

const numbered = (round: number): string => `Round ${round}`;

/**
 * The bracket as sections of round columns. Round robin has none: it is a standings table.
 * Two lives (double elimination) has "No losses", "One life left", and "Final", where the
 * rematch for the title sits when the bracket has one (docs/DOC-STYLE.md, "Tournament words
 * on screen").
 */
export function buildSections(bracket: Bracket): DisplaySection[] {
  const matches = bracket.matches.filter(isShown);
  const side = (name: BracketMatch['side']) => matches.filter((match) => match.side === name);

  if (bracket.format === 'single') {
    const columns = roundColumns(side('main'), singleRoundName);
    const third = side('third')[0];
    const last = columns[columns.length - 1];
    const lastRound = Math.max(0, ...side('main').map((match) => match.round));
    // The 3rd-place match is drawn once the final is on screen.
    if (third && last && last.key === `round-${lastRound}`) last.extra = { heading: '3rd place match', match: third };
    return columns.length > 0 ? [{ key: 'main', title: null, columns }] : [];
  }

  if (bracket.format === 'double') {
    const sections: DisplaySection[] = [];
    const winners = roundColumns(side('winners'), numbered);
    if (winners.length > 0) sections.push({ key: 'winners', title: 'No losses', columns: winners });
    const losers = roundColumns(side('losers'), numbered);
    if (losers.length > 0) sections.push({ key: 'losers', title: 'One life left', columns: losers });
    const finals: DisplayColumn[] = [];
    const final = side('final');
    const rematch = side('rematch');
    // With a rematch the first final needs a heading too, so the two cards line up.
    if (final.length > 0) finals.push({ key: 'final', heading: rematch.length > 0 ? 'First match' : null, chunks: [final] });
    if (rematch.length > 0) finals.push({ key: 'rematch', heading: 'Rematch for the title', chunks: [rematch] });
    if (finals.length > 0) sections.push({ key: 'final', title: 'Final', columns: finals });
    return sections;
  }

  return [];
}

export const columnRows = (column: DisplayColumn): number =>
  Math.max(0, ...column.chunks.map((matches) => matches.length)) + (column.extra ? 1 : 0);

/** How many cards tall a section is: its tallest column. */
export const sectionRows = (section: DisplaySection): number => Math.max(1, ...section.columns.map(columnRows));

/**
 * How tall all the sections are, in cards. A section with a title costs one more card for the
 * title and its round headings, so two lives (three titled sections) counts those.
 */
export const totalRows = (sections: DisplaySection[]): number =>
  sections.reduce((sum, section) => sum + sectionRows(section) + (section.title ? 1 : 0), 0);

// ---------------------------------------------------------------------------------------
// Size

/** `compact` puts both handles on one line, for the crowded cases. */
export interface Density {
  variant: TypeVariant;
  compact: boolean;
  /** Less space around and between cards: the last resort for 32 players in two lives on a laptop. */
  tight?: boolean;
}

/**
 * What the screen can hold. `tv` is 1920 by 1080 and up, `laptop` is a tablet or laptop (the
 * page still fits one screen), and `phone` stacks and scrolls, so it never needs to squeeze.
 */
export type Screen = 'tv' | 'laptop' | 'phone';

/**
 * The size of the match cards from how many cards stack on screen. The TV row is the largest
 * size that fit with 32 players in the first round and in two lives, measured at 1920 by 1080
 * (docs/DESIGN.md has no published TV minimum yet). The laptop row was measured at 1366 by
 * 768. Past the last row the type is as small as it goes and the cards run one line each.
 */
const DENSITY: Record<Exclude<Screen, 'phone'>, { upTo: number; density: Density }[]> = {
  tv: [
    { upTo: 2, density: { variant: 'h3', compact: false } },
    { upTo: 6, density: { variant: 'h4', compact: false } },
    { upTo: 8, density: { variant: 'h5', compact: false } },
    { upTo: 10, density: { variant: 'h6', compact: false } },
    { upTo: 17, density: { variant: 'h5', compact: true } },
    { upTo: Infinity, density: { variant: 'h6', compact: true } },
  ],
  laptop: [
    { upTo: 2, density: { variant: 'h4', compact: false } },
    { upTo: 4, density: { variant: 'h5', compact: false } },
    { upTo: 6, density: { variant: 'h6', compact: false } },
    { upTo: 10, density: { variant: 'h5', compact: true } },
    { upTo: 13, density: { variant: 'h6', compact: true } },
    { upTo: 17, density: { variant: 'subtitle1', compact: true } },
    { upTo: Infinity, density: { variant: 'body2', compact: true, tight: true } },
  ],
};

export function densityFor(rows: number, screen: Screen): Density {
  if (screen === 'phone') return { variant: 'h6', compact: false };
  const row = DENSITY[screen].find((entry) => rows <= entry.upTo);
  return row?.density ?? { variant: 'body2', compact: true, tight: true };
}

/** The type for a standings table row, from how many rows one table has. */
export function tableTypeFor(rows: number, screen: Screen): TypeVariant {
  if (screen === 'phone') return 'h6';
  if (screen === 'tv') return rows <= 6 ? 'h3' : rows <= 8 ? 'h4' : 'h5';
  return rows <= 8 ? 'h5' : rows <= 12 ? 'h6' : 'subtitle1';
}

/**
 * The type for the points table. The TV has room for h4 up to 10 rows, because the groups
 * event shows only this table on the right; past that it matches `tableTypeFor`, so 16 rows
 * and the cut line still fit at 1920 by 1080.
 */
export function heatTableType(rows: number, screen: Screen): TypeVariant {
  if (screen === 'tv' && rows > 8 && rows <= 10) return 'h4';
  return tableTypeFor(rows, screen);
}

/** One table, or two halves side by side when there are more than MAX_TABLE_ROWS rows. */
export function splitTable<T>(rows: T[]): T[][] {
  if (rows.length <= MAX_TABLE_ROWS) return [rows];
  return chunk(rows, Math.ceil(rows.length / 2));
}

/** Stations in a column of cards, or two columns from five stations up (not on a phone). */
export function stationLayout(count: number, screen: Screen): { columns: 1 | 2; variant: TypeVariant } {
  if (screen === 'phone') return { columns: 1, variant: 'h6' };
  if (screen === 'tv') {
    if (count <= 2) return { columns: 1, variant: 'h4' };
    return count <= 4 ? { columns: 1, variant: 'h5' } : { columns: 2, variant: 'h6' };
  }
  if (count <= 2) return { columns: 1, variant: 'h5' };
  return count <= 4 ? { columns: 1, variant: 'h6' } : { columns: 2, variant: 'body2' };
}

/**
 * Stations for groups. A card holds up to 4 handles, so it is about twice as tall as a match
 * card and the type sits a step or two lower. The rows are measured fits like `DENSITY`: 1 to 4
 * stations in one column on the TV, 5 to 8 in two; the laptop goes to two columns from 3, because
 * 4 tall cards and Up next ran past 768.
 */
export function heatStationLayout(count: number, screen: Screen): { columns: 1 | 2; variant: TypeVariant } {
  if (screen === 'phone') return { columns: 1, variant: 'h6' };
  if (screen === 'tv') {
    if (count <= 1) return { columns: 1, variant: 'h4' };
    if (count <= 2) return { columns: 1, variant: 'h5' };
    return count <= 4 ? { columns: 1, variant: 'h6' } : { columns: 2, variant: 'h6' };
  }
  if (count <= 1) return { columns: 1, variant: 'h6' };
  if (count <= 2) return { columns: 1, variant: 'subtitle1' };
  return { columns: 2, variant: 'body2' };
}

/** The type of the Up next list, which sits under the stations. */
export const upNextType = (screen: Screen): TypeVariant => (screen === 'tv' ? 'h5' : 'h6');

// ---------------------------------------------------------------------------------------
// Words

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** "Zap", "Zap and Kai", "Zap, Kai, and Mo". */
export function joinHandles(players: Player[]): string {
  const names = players.map((player) => player.handle);
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export function tieMessage(tie: TieNotice): string {
  const tail = tie.started ? 'Playing the tie-break.' : 'Tie-break coming up.';
  return `Tie for ${ordinal(tie.place)}: ${joinHandles(tie.players)}. ${tail}`;
}

/**
 * What a beaten player reads. In two lives a loss in the "No losses" half, or in the first
 * final when a rematch follows, leaves one life; every other loss is out.
 */
export function loserWords(format: Bracket['format'], match: BracketMatch, hasRematch: boolean): string {
  if (format === 'double' && (match.side === 'winners' || (match.side === 'final' && hasRematch))) {
    return 'One life left';
  }
  return 'Out';
}

/**
 * The count-up from the moment a station was called, as "0:07", "12:34", or "1:02:03". A
 * clock that is behind the server's shows 0:00 instead of a negative time. Null when the
 * start time is missing or unreadable.
 */
export function elapsedText(calledAt: string | null, nowMs: number): string | null {
  if (calledAt === null) return null;
  const start = Date.parse(calledAt);
  if (Number.isNaN(start)) return null;
  const total = Math.max(0, Math.floor((nowMs - start) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

// ---------------------------------------------------------------------------------------
// Final standings

/** What the podium needs of a row, so a bracket's and a group event's standings share it. */
export interface PlacedPlayer {
  place: number;
  player: Player;
}

export interface PlaceGroup<T extends PlacedPlayer = StandingsRow> {
  place: number;
  rows: T[];
}

/**
 * Places 1 to 3, one group each, and every later row in order. Places 1 to 3 are never
 * shared once a bracket is finished, but a group holds every row at its place anyway.
 */
export function splitPodium<T extends PlacedPlayer>(standings: T[]): { podium: PlaceGroup<T>[]; rest: T[] } {
  const sorted = [...standings].sort((a, b) => a.place - b.place || a.player.handle.localeCompare(b.player.handle));
  const podium: PlaceGroup<T>[] = [];
  for (const place of [1, 2, 3]) {
    const rows = sorted.filter((row) => row.place === place);
    if (rows.length > 0) podium.push({ place, rows });
  }
  return { podium, rest: sorted.filter((row) => row.place > 3) };
}

// ---------------------------------------------------------------------------------------
// Stations, standings, and Up next, for brackets and for groups

/** One station card, worked out from a bracket's station or a group event's station. */
export interface StationCard {
  number: number;
  /** After "Station n:", for a tie-break or a group; null for an ordinary match. */
  note: string | null;
  /** Empty while nothing is on the station. */
  slots: BracketSlot[];
  calledAt: string | null;
}

const slotOf = (player: Player): BracketSlot => ({ player, bye: false });

export const bracketStationCards = (stations: BracketStation[]): StationCard[] =>
  stations.map((station) => ({
    number: station.number,
    note: station.match?.side === 'tie-break' ? 'tie-break' : null,
    slots: station.match?.slots ?? [],
    calledAt: station.calledAt,
  }));

export const heatStationCards = (stations: HeatStation[]): StationCard[] =>
  stations.map((station) => ({
    number: station.number,
    note: station.heat ? heatLabel(station.heat) : null,
    slots: station.heat?.players.map(slotOf) ?? [],
    calledAt: station.calledAt,
  }));

/** What a group is called on screen (docs/DOC-STYLE.md, "Tournament words on screen"). */
export function heatLabel(heat: Heat): string {
  if (heat.kind === 'final') return 'Final';
  if (heat.kind === 'tie-break') return 'Tie-break race';
  return `Group ${heat.number}`;
}

/** One line of Up next: "Tie-break:" or "Group 4:", then the handles. */
export interface UpNextEntry {
  key: number;
  prefix: string | null;
  names: string[];
  /** Drawn small between the names ("vs" for a match); null puts a comma after each name but the last, which wraps cleanly. */
  separator: string | null;
}

export const bracketUpNext = (matches: BracketMatch[]): UpNextEntry[] =>
  matches.map((match) => ({
    key: match.id,
    prefix: match.side === 'tie-break' ? 'Tie-break:' : null,
    names: match.slots.map((slot) => slot.player?.handle ?? 'Waiting'),
    separator: 'vs',
  }));

export const heatUpNext = (heats: Heat[]): UpNextEntry[] =>
  heats.map((heat) => ({
    key: heat.id,
    prefix: `${heatLabel(heat)}:`,
    names: heat.players.map((player) => player.handle),
    separator: null,
  }));

/** One row of a standings table: wins and losses in a bracket, points and groups in a group event. */
export interface StandingsLine {
  key: number;
  place: number;
  handle: string;
  first: number;
  second: number;
  /** A word after the handle, such as "Tie" for a player in a tie that is still open. */
  note: string | null;
}

export const bracketLines = (rows: StandingsRow[]): StandingsLine[] =>
  rows.map((row) => ({ key: row.player.id, place: row.place, handle: row.player.handle, first: row.wins, second: row.losses, note: null }));

/**
 * The standings by points. A player in a tie that is still open reads "Tie", so the order
 * between the tied rows isn't taken for a result.
 */
export function heatLines(heats: Heats): StandingsLine[] {
  const tied = new Set(heats.ties.flatMap((tie) => tie.players.map((player) => player.id)));
  return heats.standings.map((row) => ({
    key: row.player.id,
    place: row.place,
    handle: row.player.handle,
    first: row.points,
    second: row.heatsPlayed,
    note: tied.has(row.player.id) ? 'Tie' : null,
  }));
}

/**
 * How many rows sit above the cut line: the places that reach the final. Null when everyone
 * reaches it (2 to 4 players) or there are no rows, so no line is drawn.
 */
export const cutAfter = (rowCount: number, finalSize: number): number | null =>
  finalSize > 0 && finalSize < rowCount ? finalSize : null;

/** The row index of the first player in an open tie at the cut, or -1 when no tie is open. */
function firstTiedIndex(heats: Heats): number {
  const tied = new Set(heats.ties.flatMap((tie) => tie.players.map((player) => player.id)));
  return heats.standings.findIndex((row) => tied.has(row.player.id));
}

/**
 * Where the cut line goes. With a tie open at the cut it goes above the whole tied group, so
 * it never reads as the tied players being in: only the rows above it are surely through.
 */
export function heatCutAfter(heats: Heats): number | null {
  const first = firstTiedIndex(heats);
  if (first >= 0 && first < heats.finalSize) return first;
  return cutAfter(heats.standings.length, heats.finalSize);
}

/** Before any qualifying group has a result, every player is level, so there are no places to show. */
export const noResultsYet = (heats: Heats): boolean =>
  heats.standings.length > 0 && heats.standings.every((row) => row.heatsPlayed === 0);

/** "Round 1 of 2" while qualifying goes on; null at a tie-break or the final. */
export const heatRoundText = (heats: Heats): string | null =>
  heats.round !== null && heats.rounds > 0 ? `Round ${heats.round} of ${heats.rounds}` : null;

/**
 * The one line a tie at the cut shows, worded by what is at stake: "Zap, Jett, Dash, and Jinx
 * are tied. 2 of them go to the final. Tie-break race coming up." The spots are the places the
 * final has left after the players surely in (docs/PLAN.md, "Ties").
 */
export function heatTieMessage(tie: TieNotice, heats: Heats): string {
  const tail = tie.started ? 'Playing the tie-break race.' : 'Tie-break race coming up.';
  const tied = tie.players.map((player) => player.id);
  const first = heats.standings.findIndex((row) => tied.includes(row.player.id));
  const spots = heats.finalSize - first;
  const spotsText = first >= 0 && spots >= 1 && spots < tie.players.length ? ` ${spots} of them ${spots === 1 ? 'goes' : 'go'} to the final.` : '';
  return `${joinHandles(tie.players)} are tied.${spotsText} ${tail}`;
}

/** The final once it is made, or null while qualifying or a tie-break still has to finish. */
export const finalHeat = (heats: Heats): Heat | null => heats.heats.find((heat) => heat.kind === 'final') ?? null;

export interface Finalist {
  player: Player;
  /** Qualifying points; null when the final is the only group (2 to 4 players). */
  points: number | null;
}

/** The final's players, best qualifier first, with the points they came in with. */
export function finalists(heats: Heats, final: Heat): Finalist[] {
  const rank = new Map(heats.standings.map((row, index) => [row.player.id, { index, points: row.points }]));
  return final.players
    .map((player) => ({ player, points: heats.rounds > 0 ? (rank.get(player.id)?.points ?? null) : null, index: rank.get(player.id)?.index ?? Infinity }))
    .sort((a, b) => a.index - b.index)
    .map(({ player, points }) => ({ player, points }));
}

/** "1 point" or "12 points". */
export const pointsText = (points: number): string => `${points} ${points === 1 ? 'point' : 'points'}`;
