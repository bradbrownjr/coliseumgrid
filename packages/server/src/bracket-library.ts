// Every call into brackets-manager lives in this file (docs/PLAN.md, "1 vs 1 bracket"). The
// library has one maintainer, so the rest of the server sees only the plain shapes below
// and the library could be swapped out here alone.
//
// The library keeps its state in a store. We never keep that store: each call builds a new
// in-memory one, creates the stage from the seeding, and replays the result log in order
// (docs/PLAN.md, "Brackets API"). The library's own undo (`reset.matchResults`) and late
// seeding (`update.seeding`) gave wrong brackets in testing, so neither is called: an older
// undo in the log starts a new store and replays the results still standing.

import type { BracketFormat } from '@coliseumgrid/core';
import { BracketsManager } from 'brackets-manager';
import { InMemoryDatabase } from 'brackets-memory-db';
import { Status, type Match, type ParticipantResult, type StageSettings, type StageType } from 'brackets-model';

/** Where a library match sits; the same words as core's `MatchSide`, less `tie-break`. */
export type LibrarySide = 'main' | 'winners' | 'losers' | 'final' | 'rematch' | 'third';

/** `bye`: the slot is empty for good. `tbd`: a player will come from an earlier match. */
export type LibrarySlot = { kind: 'bye' } | { kind: 'tbd' } | { kind: 'player'; id: number };

export interface LibraryMatch {
  id: number;
  side: LibrarySide;
  /** From 1 within the side. */
  round: number;
  /** From 1 within the round. */
  number: number;
  slots: [LibrarySlot, LibrarySlot];
  /** Ready to play now: both players known, no result, and needed. */
  playable: boolean;
}

/** A log entry for a library match. `step` is its place in the whole log, counting from 0. */
export type LibraryEntry =
  | { kind: 'result'; step: number; matchId: number; winnerId: number; loserId: number }
  /** An older undo; `of` is the step of the result it takes back. */
  | { kind: 'undo'; step: number; of: number };

type LibraryResult = Extract<LibraryEntry, { kind: 'result' }>;

/**
 * One stretch of steps during which a match was ready to play with these two players. It ends
 * with the match's result (`until` null), or at `until` when an older undo took a player away.
 */
export interface LibraryReady {
  matchId: number;
  players: [number, number];
  from: number;
  until: number | null;
  /** It started at an older undo of this match's own result. */
  reopened: boolean;
}

export type LibraryReplay = { ok: true; matches: LibraryMatch[]; ready: LibraryReady[] } | { ok: false; step: number };

const STAGE_TYPE: Record<BracketFormat, StageType> = {
  single: 'single_elimination',
  double: 'double_elimination',
  round_robin: 'round_robin',
};

function settingsFor(format: BracketFormat, slots: number): StageSettings {
  // inner_outer puts seed 1 against the last seed, so the nulls padded at the end of the
  // seeding become byes for the first seeds and two byes never meet.
  if (format === 'round_robin') return { groupCount: 1, roundRobinMode: 'simple' };
  if (format === 'double') return { seedOrdering: ['inner_outer'], grandFinal: 'double' };
  // The library throws on a 3rd-place match with fewer than 4 slots.
  return { seedOrdering: ['inner_outer'], consolationFinal: slots >= 4 };
}

/** The store's own tables, read without the copy that `select` makes on every call. */
class ReplayDatabase extends InMemoryDatabase {
  matches(): readonly Match[] {
    return this.data.match;
  }
}

interface Stage {
  db: ReplayDatabase;
  /** Match id to its row in the table. Rows are only replaced in place, never added or removed. */
  rowOf: Map<number, number>;
  manager: BracketsManager;
  slotOf: (opponent: ParticipantResult | null) => LibrarySlot;
  sides: Map<number, { side: LibrarySide; round: number }>;
  isPlayable: (match: Match) => boolean;
}

/** A new in-memory store holding the stage made from the seeding, with no results. */
async function newStage(format: BracketFormat, seeding: ReadonlyArray<number | null>): Promise<Stage> {
  const db = new ReplayDatabase();
  const manager = new BracketsManager(db);
  // Participants are named by player id, so no handle ever reaches the library (CLAUDE.md,
  // rule 1) and its participant ids map back through the name.
  const stage = await manager.create.stage({
    tournamentId: 0,
    name: 'Bracket',
    type: STAGE_TYPE[format],
    seeding: seeding.map((id) => (id === null ? null : String(id))),
    settings: settingsFor(format, seeding.length),
  });
  const playerOf = new Map<number, number>();
  for (const participant of (await manager.storage.select('participant')) ?? []) {
    playerOf.set(Number(participant.id), Number(participant.name));
  }
  const groupNumber = new Map<number, number>();
  for (const group of (await manager.storage.select('group', { stage_id: stage.id })) ?? []) {
    groupNumber.set(Number(group.id), group.number);
  }
  const roundNumber = new Map<number, number>();
  for (const round of (await manager.storage.select('round', { stage_id: stage.id })) ?? []) {
    roundNumber.set(Number(round.id), round.number);
  }

  const sideOf = (match: Match): { side: LibrarySide; round: number } => {
    const group = groupNumber.get(Number(match.group_id)) ?? 0;
    const round = roundNumber.get(Number(match.round_id)) ?? 0;
    if (format === 'round_robin') return { side: 'main', round };
    if (format === 'single') return group === 1 ? { side: 'main', round } : { side: 'third', round };
    if (group === 1) return { side: 'winners', round };
    if (group === 2) return { side: 'losers', round };
    return round === 1 ? { side: 'final', round: 1 } : { side: 'rematch', round: 1 };
  };

  const slotOf = (opponent: ParticipantResult | null): LibrarySlot => {
    if (opponent === null) return { kind: 'bye' };
    if (opponent.id === null) return { kind: 'tbd' };
    return { kind: 'player', id: playerOf.get(Number(opponent.id)) as number };
  };

  const sides = new Map<number, { side: LibrarySide; round: number }>();
  for (const match of db.matches()) sides.set(Number(match.id), sideOf(match));

  // With grandFinal 'double' the library opens the rematch after every first final, but
  // only a win by the player from the losers' side (opponent2) makes it count
  // (getGrandFinalDecisiveMatch in its helpers.js). A rematch after a win by the winners'
  // side is never played.
  const finalMatch = (): Match | undefined => db.matches().find((m) => sides.get(Number(m.id))?.side === 'final');
  const rematchNeeded = (): boolean => finalMatch()?.opponent2?.result === 'win';
  const isPlayable = (match: Match): boolean =>
    match.status === Status.Ready && (sides.get(Number(match.id))?.side !== 'rematch' || rematchNeeded());

  const rowOf = new Map(db.matches().map((m, row) => [Number(m.id), row]));
  return { db, rowOf, manager, slotOf, sides, isPlayable };
}

/** Records one result. False when its match isn't playable or doesn't hold its two players. */
async function apply(stage: Stage, result: LibraryResult): Promise<boolean> {
  const row = stage.rowOf.get(result.matchId);
  const match = row === undefined ? undefined : stage.db.matches()[row];
  if (!match || !stage.isPlayable(match)) return false;
  const a = stage.slotOf(match.opponent1);
  const b = stage.slotOf(match.opponent2);
  const ids = [a.kind === 'player' ? a.id : null, b.kind === 'player' ? b.id : null];
  if (result.winnerId === result.loserId || !ids.includes(result.winnerId) || !ids.includes(result.loserId)) return false;
  const firstWon = ids[0] === result.winnerId;
  await stage.manager.update.match({
    id: match.id,
    opponent1: { result: firstWon ? 'win' : 'loss' },
    opponent2: { result: firstWon ? 'loss' : 'win' },
  });
  return true;
}

/**
 * Builds the bracket from the seeding and replays `entries`. Each result must be for a
 * playable match holding the same two players, or the answer names the step that failed. An
 * older undo starts a new store and replays the results still standing, which fails if a
 * later one depended on the result taken back. Entries for matches that aren't the
 * library's (tie-breaks) are left out by the caller; `step` keeps every entry's place in the
 * whole log.
 */
export async function replayLibrary(
  format: BracketFormat,
  seeding: ReadonlyArray<number | null>,
  entries: readonly LibraryEntry[],
): Promise<LibraryReplay> {
  let stage = await newStage(format, seeding);
  // The results standing, by step, in log order.
  const standing = new Map<number, LibraryResult>();

  // After each entry, matches' readiness is compared with the one before. A result only ends
  // its own match and makes others ready, so after one the matches still ready are skipped,
  // and so are those ended by their own result since the last full look. After an undo every
  // match is looked at.
  const ready: LibraryReady[] = [];
  const open = new Map<number, LibraryReady>();
  const ended = new Set<number>();
  const scan = (step: number, entry: LibraryEntry | null, undoneMatch: number | null): void => {
    const full = entry?.kind !== 'result';
    if (full) ended.clear();
    for (const match of stage.db.matches()) {
      const id = Number(match.id);
      if (!full && id !== entry.matchId && (open.has(id) || ended.has(id))) continue;
      const a = stage.slotOf(match.opponent1);
      const b = stage.slotOf(match.opponent2);
      const players: [number, number] | null =
        stage.isPlayable(match) && a.kind === 'player' && b.kind === 'player' ? [a.id, b.id] : null;
      const was = open.get(id);
      if (was && (players === null || players[0] !== was.players[0] || players[1] !== was.players[1])) {
        // Its own result ends it; anything else took a player away.
        if (entry?.kind === 'result' && entry.matchId === id) ended.add(id);
        else was.until = step;
        open.delete(id);
      }
      if (players && !open.has(id)) {
        const now: LibraryReady = { matchId: id, players, from: step, until: null, reopened: undoneMatch === id };
        ready.push(now);
        open.set(id, now);
      }
    }
  };

  scan(0, null, null);
  for (const entry of entries) {
    let undoneMatch: number | null = null;
    if (entry.kind === 'result') {
      if (!(await apply(stage, entry))) return { ok: false, step: entry.step };
      standing.set(entry.step, entry);
    } else {
      const undone = standing.get(entry.of);
      if (!undone) return { ok: false, step: entry.step };
      standing.delete(entry.of);
      undoneMatch = undone.matchId;
      stage = await newStage(format, seeding);
      for (const result of standing.values()) {
        if (!(await apply(stage, result))) return { ok: false, step: entry.step };
      }
    }
    scan(entry.step + 1, entry, undoneMatch);
  }

  const matches = stage.db.matches().map((match): LibraryMatch => {
    const id = Number(match.id);
    const place = stage.sides.get(id) as { side: LibrarySide; round: number };
    return {
      id,
      side: place.side,
      round: place.round,
      number: match.number,
      slots: [stage.slotOf(match.opponent1), stage.slotOf(match.opponent2)],
      playable: stage.isPlayable(match),
    };
  });
  return { ok: true, matches, ready };
}
