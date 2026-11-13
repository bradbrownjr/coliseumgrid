// Every call into brackets-manager lives in this file (docs/PLAN.md, "1 vs 1 bracket"). The
// library has one maintainer, so the rest of the server sees only the plain shapes below
// and the library could be swapped out here alone.
//
// The library keeps its state in a store. We never keep that store: each call builds a new
// in-memory one, creates the stage from the seeding, and replays the result log in order
// (docs/PLAN.md, "Brackets API"). The library's own undo (`reset.matchResults`) and late
// seeding (`update.seeding`) gave wrong brackets in testing, so neither is called.

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
  /** The step at which both players were first known and it could be played; null if never. */
  readyStep: number | null;
  /** Ready to play now: both players known, no result, and needed. */
  playable: boolean;
}

export interface LibraryResult {
  /** The step this result makes: its place in the whole log, counting from 0. */
  step: number;
  matchId: number;
  winnerId: number;
  loserId: number;
}

export type LibraryReplay = { ok: true; matches: LibraryMatch[] } | { ok: false; step: number };

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

/**
 * Builds the bracket from the seeding and replays `results`. Each logged match must be
 * playable and hold the same two players, or the answer names the step that failed.
 * Results for matches that aren't the library's (tie-breaks) are left out by the caller;
 * `step` keeps every result's place in the whole log.
 */
export async function replayLibrary(
  format: BracketFormat,
  seeding: ReadonlyArray<number | null>,
  results: readonly LibraryResult[],
): Promise<LibraryReplay> {
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

  // Rows are only replaced in place during a replay, never added or removed, so each match
  // keeps its index in the table.
  const indexOf = new Map(db.matches().map((m, index) => [Number(m.id), index]));
  const readyStep = new Map<number, number>();
  let notReady = [...indexOf.values()];
  const noteReady = (step: number): void => {
    notReady = notReady.filter((index) => {
      const match = db.matches()[index] as Match;
      if (!isPlayable(match)) return true;
      readyStep.set(Number(match.id), step);
      return false;
    });
  };

  noteReady(0);
  for (const result of results) {
    const index = indexOf.get(result.matchId);
    const match = index === undefined ? undefined : db.matches()[index];
    if (!match || !isPlayable(match)) return { ok: false, step: result.step };
    const a = slotOf(match.opponent1);
    const b = slotOf(match.opponent2);
    const ids = [a.kind === 'player' ? a.id : null, b.kind === 'player' ? b.id : null];
    if (result.winnerId === result.loserId || !ids.includes(result.winnerId) || !ids.includes(result.loserId)) {
      return { ok: false, step: result.step };
    }
    const firstWon = ids[0] === result.winnerId;
    await manager.update.match({
      id: match.id,
      opponent1: { result: firstWon ? 'win' : 'loss' },
      opponent2: { result: firstWon ? 'loss' : 'win' },
    });
    noteReady(result.step + 1);
  }

  const matches = db.matches().map((match): LibraryMatch => {
    const id = Number(match.id);
    const place = sides.get(id) as { side: LibrarySide; round: number };
    return {
      id,
      side: place.side,
      round: place.round,
      number: match.number,
      slots: [slotOf(match.opponent1), slotOf(match.opponent2)],
      readyStep: readyStep.get(id) ?? null,
      playable: isPlayable(match),
    };
  });
  return { ok: true, matches };
}
