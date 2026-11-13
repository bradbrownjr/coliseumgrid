// The bracket engine (docs/PLAN.md, "1 vs 1 bracket", "Ties", "Late sign-up", "Stations and
// the queue", and "Brackets API"). A bracket is its settings, a seeding list, the late
// joins, the log, and the tie-break matches made so far. Every answer is rebuilt from those
// by replay. Undoing the newest result takes it out of the log and gives back exactly the
// bracket it had before (CLAUDE.md, rule 5). Undoing an older result adds an undo to the
// log instead, so every match being played keeps its station.
//
// Each operation takes a state and gives back a new state with its answer, or a refusal.
// Nothing here touches the database or the clock: the caller stores the state, passes in
// the time and the new result's id, and runs one operation at a time.

import {
  BRACKET_PLAYERS_MAX,
  STATIONS_MAX,
  STATIONS_MIN,
  addLatePlayer,
  bracketPlayersMin,
  buildQueue,
  rankRoundRobin,
  seedPlayers,
  type ApiErrorCode,
  type BestOf,
  type Bracket,
  type BracketFormat,
  type BracketMatch,
  type BracketSlot,
  type MatchSide,
  type Player,
  type QueueMatch,
  type QueueState,
  type RandomSource,
  type RoundRobinRanking,
  type StandingsRow,
  type TieNotice,
} from '@coliseumgrid/core';
import { replayLibrary, type LibraryEntry, type LibraryMatch, type LibrarySlot } from './bracket-library.ts';

export interface BracketSettings {
  id: number;
  format: BracketFormat;
  bestOf: BestOf;
  /** 1 to 8, fixed for the life of the bracket. */
  stations: number;
  /** ISO 8601; the first matches are called at this time. */
  createdAt: string;
}

export interface BracketResultRecord {
  id: number;
  matchId: number;
  winnerId: number;
  loserId: number;
  /** ISO 8601; the station it frees is called again at this time. */
  at: string;
  /**
   * Set when an older undo took it back. The result stays in the log, so the stations it
   * freed stay as they were, and the undo is the log entry at `step`.
   */
  undone?: { step: number; at: string };
}

/** A player added after the start. `step` is the number of log entries when they joined. */
export interface LateJoin {
  playerId: number;
  step: number;
}

/**
 * A tie-break match, in the order made. Its match id is `TIE_BREAK_ID_BASE` plus its place in
 * the list, so the list is only ever added to at the end or cut back from the end.
 */
export interface TieBreakRecord {
  /** The group's tie-break round, from 1 (core's `TieBreakNeeded.round`). */
  round: number;
  players: [number, number];
  /** The number of log entries when it was made. */
  step: number;
}

export interface BracketState {
  settings: BracketSettings;
  /** Player ids in starting-spot order, nulls for empty slots; late players fill nulls. */
  seeding: Array<number | null>;
  lateJoins: LateJoin[];
  /**
   * Every result in the order recorded, undone ones included. With the undos (each at its
   * `undone.step`) they make the log: entry k is step k + 1.
   */
  results: BracketResultRecord[];
  tieBreaks: TieBreakRecord[];
}

/** Player id to the current handle. Every player in the seeding must be in it. */
export type HandleLookup = ReadonlyMap<number, string>;

export type EngineAnswer = { ok: true; state: BracketState; bracket: Bracket } | { ok: false; error: ApiErrorCode };

/**
 * Tie-break match ids start here, past the library's ids (0 up to its match count; a round
 * robin of 32 has 496 matches), so the two never meet.
 */
export const TIE_BREAK_ID_BASE = 1000;

const FORMATS: readonly BracketFormat[] = ['single', 'double', 'round_robin'];
const BEST_OF: readonly number[] = [1, 3, 5];

type EngineSlot = LibrarySlot;

interface EngineMatch {
  id: number;
  side: MatchSide;
  round: number;
  number: number;
  slots: [EngineSlot, EngineSlot];
  /** Both players known and needed: playable now unless it has a result. */
  ready: boolean;
}

/** One log entry: a result, or an older undo of `result`. */
type LogEntry = { kind: 'result'; result: BracketResultRecord } | { kind: 'undo'; result: BracketResultRecord; at: string };

/** One replay of a state: everything an answer or a check needs. */
interface Built {
  /** The matches in the answer: the library's (less an unneeded rematch), then tie-breaks. */
  matches: EngineMatch[];
  byId: Map<number, EngineMatch>;
  /** The results standing: not undone. */
  resultOf: Map<number, BracketResultRecord>;
  log: LogEntry[];
  queue: QueueState;
  /** Round robin only. */
  ranking: RoundRobinRanking | null;
}

const playerIdOf = (slot: EngineSlot): number | null => (slot.kind === 'player' ? slot.id : null);
const isBye = (m: EngineMatch): boolean => m.slots[0].kind === 'bye' || m.slots[1].kind === 'bye';
const sameSlots = (a: EngineMatch, b: EngineMatch): boolean =>
  playerIdOf(a.slots[0]) === playerIdOf(b.slots[0]) && playerIdOf(a.slots[1]) === playerIdOf(b.slots[1]);

/**
 * The log in step order: the results in the order recorded, with each older undo at its
 * step. Null if the steps don't fit together, or an undo comes before its result.
 */
function logOf(results: readonly BracketResultRecord[]): LogEntry[] | null {
  const undoAt = new Map<number, BracketResultRecord>();
  for (const r of results) {
    if (!r.undone) continue;
    if (undoAt.has(r.undone.step)) return null;
    undoAt.set(r.undone.step, r);
  }
  const log: LogEntry[] = [];
  const placed = new Set<number>();
  let next = 0;
  for (let step = 0; step < results.length + undoAt.size; step++) {
    const undone = undoAt.get(step);
    if (undone) {
      if (!placed.has(undone.id)) return null;
      log.push({ kind: 'undo', result: undone, at: (undone.undone as { at: string }).at });
    } else {
      const result = results[next++];
      if (!result) return null;
      placed.add(result.id);
      log.push({ kind: 'result', result });
    }
  }
  return log;
}

/** The number of log entries: the step a change made now is at. */
const stepNow = (state: BracketState): number => state.results.length + state.results.filter((r) => r.undone).length;

/** Replays a state. Null when a logged result no longer fits its match. */
async function rebuild(state: BracketState): Promise<Built | null> {
  const { settings, seeding, lateJoins, results, tieBreaks } = state;
  const log = logOf(results);
  if (!log) return null;
  const stepOf = new Map<number, number>();
  const libraryEntries: LibraryEntry[] = [];
  for (const [step, e] of log.entries()) {
    if (e.kind === 'result') stepOf.set(e.result.id, step);
    if (e.result.matchId >= TIE_BREAK_ID_BASE) continue;
    libraryEntries.push(
      e.kind === 'result'
        ? { kind: 'result', step, matchId: e.result.matchId, winnerId: e.result.winnerId, loserId: e.result.loserId }
        : { kind: 'undo', step, of: stepOf.get(e.result.id) as number },
    );
  }
  const replay = await replayLibrary(settings.format, seeding, libraryEntries);
  if (!replay.ok) return null;
  if (replay.matches.some((m) => m.id >= TIE_BREAK_ID_BASE)) throw new Error('library match ids reach the tie-break ids');

  const resultOf = new Map<number, BracketResultRecord>();
  for (const r of results) if (!r.undone) resultOf.set(r.matchId, r);

  // Tie-break results: the match must have been made before the result, the winner and
  // loser must be its two players, and it can't have a result standing already. Each time a
  // tie-break's result is taken back by an older undo, the match is ready again from then.
  const tieReopened = new Map<number, number[]>();
  const tieStanding = new Set<number>();
  for (const [step, e] of log.entries()) {
    const r = e.result;
    if (r.matchId < TIE_BREAK_ID_BASE) continue;
    if (e.kind === 'undo') {
      tieStanding.delete(r.matchId);
      tieReopened.set(r.matchId, [...(tieReopened.get(r.matchId) ?? []), step + 1]);
      continue;
    }
    const made = tieBreaks[r.matchId - TIE_BREAK_ID_BASE];
    if (!made || made.step > step || tieStanding.has(r.matchId)) return null;
    tieStanding.add(r.matchId);
    const [a, b] = made.players;
    if (!((r.winnerId === a && r.loserId === b) || (r.winnerId === b && r.loserId === a))) return null;
  }

  // The rematch for the title counts only when the player from the losers' side won the
  // first final (opponent2). Otherwise it is left out of the answer.
  const final = replay.matches.find((m) => m.side === 'final');
  const finalResult = final && resultOf.get(final.id);
  const rematchUnneeded = final !== undefined && finalResult !== undefined && finalResult.winnerId === playerIdOf(final.slots[0]);

  const fromLibrary = (m: LibraryMatch): EngineMatch => ({
    id: m.id,
    side: m.side,
    round: m.round,
    number: m.number,
    slots: m.slots,
    ready: m.playable,
  });
  const numberInRound = new Map<number, number>();
  const fromTieBreak = (t: TieBreakRecord, index: number): EngineMatch => {
    const number = (numberInRound.get(t.round) ?? 0) + 1;
    numberInRound.set(t.round, number);
    return {
      id: TIE_BREAK_ID_BASE + index,
      side: 'tie-break',
      round: t.round,
      number,
      slots: [
        { kind: 'player', id: t.players[0] },
        { kind: 'player', id: t.players[1] },
      ],
      ready: true,
    };
  };
  const libraryMatches = replay.matches.map(fromLibrary);
  const tieBreakMatches = tieBreaks.map(fromTieBreak);
  const matches = [...libraryMatches.filter((m) => !(m.side === 'rematch' && rematchUnneeded)), ...tieBreakMatches];
  const byId = new Map(matches.map((m) => [m.id, m]));

  // A player whose first-round match is a bye. Their next match waits until round 1 is
  // finished, so the bye stays open for a late player (docs/PLAN.md, "Late sign-up").
  const elimination = settings.format !== 'round_robin';
  const firstRound = (m: EngineMatch): boolean => elimination && (m.side === 'main' || m.side === 'winners') && m.round === 1;
  const byePlayers = new Set<number>();
  for (const m of matches) {
    if (!firstRound(m) || !isBye(m)) continue;
    for (const slot of m.slots) if (slot.kind === 'player') byePlayers.add(slot.id);
  }
  const joinStep = new Map(lateJoins.map((j) => [j.playerId, j.step]));
  const queueMatches: QueueMatch[] = [];
  const queueEntry = (m: EngineMatch, players: [number, number], from: number, until: number | null, reopened: boolean): void => {
    // A late player's match is ready from the step they joined, behind matches already waiting.
    const joined = Math.max(-1, ...players.map((id) => joinStep.get(id) ?? -1));
    const readyStep = Math.max(from, joined);
    if (until !== null && readyStep >= until) return;
    queueMatches.push({
      id: m.id,
      round: m.round,
      number: m.number,
      players,
      readyStep,
      late: joined >= from,
      ...(reopened ? { reopened } : {}),
      ...(until !== null ? { until } : {}),
      firstRound: firstRound(m),
      hasByePlayer: byePlayers.has(players[0]) || byePlayers.has(players[1]),
    });
  };
  const libraryById = new Map(libraryMatches.map((m) => [m.id, m]));
  for (const r of replay.ready) queueEntry(libraryById.get(r.matchId) as EngineMatch, r.players, r.from, r.until, r.reopened);
  tieBreakMatches.forEach((m, index) => {
    const t = tieBreaks[index] as TieBreakRecord;
    queueEntry(m, t.players, t.step, null, false);
    for (const step of tieReopened.get(m.id) ?? []) queueEntry(m, t.players, step, null, true);
  });
  const queue = buildQueue({
    stations: settings.stations,
    createdAt: settings.createdAt,
    matches: queueMatches,
    results: log.map((e) => (e.kind === 'result' ? { matchId: e.result.matchId, at: e.result.at } : { matchId: null, at: e.at })),
  });

  let ranking: RoundRobinRanking | null = null;
  if (settings.format === 'round_robin') {
    const players = seeding.filter((id): id is number => id !== null);
    const standing = results.filter((r) => !r.undone);
    const main = standing.filter((r) => r.matchId < TIE_BREAK_ID_BASE).map((r) => ({ winner: r.winnerId, loser: r.loserId }));
    const extra = standing
      .filter((r) => r.matchId >= TIE_BREAK_ID_BASE)
      .map((r) => ({ winner: r.winnerId, loser: r.loserId, round: (byId.get(r.matchId) as EngineMatch).round }));
    ranking = rankRoundRobin(players, main, extra);
  }

  return { matches, byId, resultOf, log, queue, ranking };
}

async function rebuildOrThrow(state: BracketState): Promise<Built> {
  const built = await rebuild(state);
  if (!built) throw new Error(`bracket ${state.settings.id}: the stored result log does not replay`);
  return built;
}

const onStation = (built: Built, matchId: number): boolean => built.queue.stations.some((s) => s.matchId === matchId);

/** Round 1 is finished when every first-round match that isn't a bye has a result. */
function roundOneFinished(built: Built): boolean {
  return built.matches
    .filter((m) => (m.side === 'main' || m.side === 'winners') && m.round === 1 && !isBye(m))
    .every((m) => built.resultOf.has(m.id));
}

/** Places for single and double elimination: 1 to 3 by play, lower places shared by round out. */
function eliminationPlaces(format: BracketFormat, built: Built): Map<number, number> {
  const tiers: Array<{ size: number; players: number[] }> = [];
  const of = (m: EngineMatch | undefined): { winner: number; loser: number } | null => {
    const r = m && built.resultOf.get(m.id);
    return r ? { winner: r.winnerId, loser: r.loserId } : null;
  };
  const losersOf = (ms: EngineMatch[]): { size: number; players: number[] } => ({
    size: ms.filter((m) => !isBye(m)).length,
    players: ms.flatMap((m) => {
      const r = of(m);
      return r ? [r.loser] : [];
    }),
  });
  const side = (name: MatchSide): EngineMatch[] => built.matches.filter((m) => m.side === name);
  const lastRound = (ms: EngineMatch[]): number => Math.max(0, ...ms.map((m) => m.round));

  if (format === 'single') {
    const main = side('main');
    const rounds = lastRound(main);
    const final = of(main.find((m) => m.round === rounds));
    tiers.push({ size: 1, players: final ? [final.winner] : [] }, { size: 1, players: final ? [final.loser] : [] });
    const third = side('third')[0];
    if (third && isBye(third)) {
      // With 3 players one semi-final is a bye, so the other semi-final's loser is 3rd.
      const sole = third.slots.map(playerIdOf).find((id) => id !== null);
      tiers.push({ size: 1, players: sole === undefined || sole === null ? [] : [sole] });
    } else if (third) {
      const r = of(third);
      tiers.push({ size: 1, players: r ? [r.winner] : [] }, { size: 1, players: r ? [r.loser] : [] });
    }
    for (let round = third ? rounds - 2 : rounds - 1; round >= 1; round--) {
      tiers.push(losersOf(main.filter((m) => m.round === round)));
    }
  } else {
    const final = side('final')[0];
    const first = of(final);
    const decider = first && final && first.winner === playerIdOf(final.slots[0]) ? first : of(side('rematch')[0]);
    tiers.push({ size: 1, players: decider ? [decider.winner] : [] }, { size: 1, players: decider ? [decider.loser] : [] });
    const losers = side('losers');
    for (let round = lastRound(losers); round >= 1; round--) {
      tiers.push(losersOf(losers.filter((m) => m.round === round)));
    }
  }

  const places = new Map<number, number>();
  let place = 1;
  for (const tier of tiers) {
    for (const id of tier.players) places.set(id, place);
    place += tier.size;
  }
  return places;
}

function buildAnswer(state: BracketState, built: Built, handles: HandleLookup, lateOpen: boolean): Bracket {
  const player = (id: number): Player => {
    const handle = handles.get(id);
    if (handle === undefined) throw new Error(`bracket ${state.settings.id}: no handle for player ${id}`);
    return { id, handle };
  };
  const slotView = (slot: EngineSlot): BracketSlot =>
    slot.kind === 'player' ? { player: player(slot.id), bye: false } : { player: null, bye: slot.kind === 'bye' };
  const matchView = (m: EngineMatch): BracketMatch => {
    const result = built.resultOf.get(m.id);
    let status: BracketMatch['status'] = 'waiting';
    if (isBye(m)) status = 'bye';
    else if (result) status = 'done';
    else if (onStation(built, m.id)) status = 'playing';
    else if (m.ready) status = 'ready';
    return {
      id: m.id,
      side: m.side,
      round: m.round,
      number: m.number,
      status,
      slots: [slotView(m.slots[0]), slotView(m.slots[1])],
      winner: result ? (playerIdOf(m.slots[0]) === result.winnerId ? 0 : 1) : null,
      resultId: result ? result.id : null,
    };
  };
  const views = new Map(built.matches.map((m) => [m.id, matchView(m)]));
  const viewOf = (id: number): BracketMatch => views.get(id) as BracketMatch;

  // Wins and losses count every result standing in this bracket, tie-breaks included.
  const wins = new Map<number, number>();
  const losses = new Map<number, number>();
  for (const r of built.resultOf.values()) {
    wins.set(r.winnerId, (wins.get(r.winnerId) ?? 0) + 1);
    losses.set(r.loserId, (losses.get(r.loserId) ?? 0) + 1);
  }
  const row = (place: number, id: number): StandingsRow => ({ place, player: player(id), wins: wins.get(id) ?? 0, losses: losses.get(id) ?? 0 });

  let standings: StandingsRow[];
  let ties: TieNotice[] = [];
  if (built.ranking) {
    standings = built.ranking.groups.flatMap((g) => g.players.map((id) => row(g.place, id)));
    ties = built.ranking.tieBreaks.map((t) => ({
      place: t.place,
      players: t.players.map(player),
      started: state.tieBreaks.some((made) => made.round === t.round && made.players.every((id) => t.players.includes(id))),
    }));
  } else {
    // Only players whose place is settled, best first; everyone once the bracket is finished.
    const places = eliminationPlaces(state.settings.format, built);
    const order = state.seeding.filter((id): id is number => id !== null && places.has(id));
    order.sort((a, b) => (places.get(a) as number) - (places.get(b) as number));
    standings = order.map((id) => row(places.get(id) as number, id));
  }

  // The newest result standing: what a recorded result answers with, and what to undo last.
  const lastResult = state.results.filter((r) => !r.undone).at(-1);
  return {
    id: state.settings.id,
    format: state.settings.format,
    bestOf: state.settings.bestOf,
    finished: [...views.values()].every((m) => m.status === 'done' || m.status === 'bye') && ties.length === 0,
    lateOpen,
    lastResultId: lastResult ? lastResult.id : null,
    stations: built.queue.stations.map((s) => ({ number: s.number, match: s.matchId === null ? null : viewOf(s.matchId), calledAt: s.calledAt })),
    upNext: built.queue.upNext.map(viewOf),
    matches: built.matches.map((m) => viewOf(m.id)),
    standings,
    ties,
  };
}

/**
 * A late player takes the first empty slot (docs/PLAN.md, "Late sign-up"). Refused once round
 * 1 is finished, with no empty slot (so a round robin with an even count), or when any
 * logged result or any match on a station would change.
 */
async function tryJoin(
  state: BracketState,
  built: Built,
  playerId: number,
): Promise<{ ok: true; state: BracketState; built: Built } | { ok: false; error: ApiErrorCode }> {
  if (state.seeding.includes(playerId)) return { ok: false, error: 'already-in' };
  if (roundOneFinished(built)) return { ok: false, error: 'late-closed' };
  const seeding = addLatePlayer(state.seeding, playerId);
  if (!seeding) return { ok: false, error: 'late-closed' };
  const next: BracketState = { ...state, seeding, lateJoins: [...state.lateJoins, { playerId, step: stepNow(state) }] };
  const after = await rebuild(next);
  if (!after || after.queue.offStation.length > 0) return { ok: false, error: 'late-closed' };
  // A station keeps its match. An idle station may take the late player's match, and nothing else.
  const kept = built.queue.stations.every((s, i) => {
    const now = after.queue.stations[i];
    if (!now) return false;
    if (s.matchId === null) {
      return now.matchId === null || (after.byId.get(now.matchId) as EngineMatch).slots.some((slot) => playerIdOf(slot) === playerId);
    }
    if (now.matchId !== s.matchId || now.calledAt !== s.calledAt) return false;
    return sameSlots(built.byId.get(s.matchId) as EngineMatch, after.byId.get(s.matchId) as EngineMatch);
  });
  if (!kept) return { ok: false, error: 'late-closed' };
  return { ok: true, state: next, built: after };
}

/** No real player has a negative id, so this stands in for "anyone" when asking if a join would pass. */
const ANY_PLAYER = -1;

async function answerFor(state: BracketState, built: Built, handles: HandleLookup): Promise<Bracket> {
  const lateOpen = (await tryJoin(state, built, ANY_PLAYER)).ok;
  return buildAnswer(state, built, handles, lateOpen);
}

/** The answer for a stored bracket. Throws if the stored log doesn't replay, which is a bug. */
export async function bracketAnswer(state: BracketState, handles: HandleLookup): Promise<Bracket> {
  return answerFor(state, await rebuildOrThrow(state), handles);
}

export interface NewBracket {
  id: number;
  format: BracketFormat;
  bestOf: BestOf;
  stations: number;
  playerIds: number[];
  createdAt: string;
}

/** Makes a bracket with a random seeding from `random`. */
export async function createBracket(input: NewBracket, random: RandomSource, handles: HandleLookup): Promise<EngineAnswer> {
  const { format, bestOf, stations, playerIds } = input;
  if (!FORMATS.includes(format) || !BEST_OF.includes(bestOf)) return { ok: false, error: 'bad-request' };
  if (!Number.isInteger(stations) || stations < STATIONS_MIN || stations > STATIONS_MAX) return { ok: false, error: 'bad-request' };
  if (!playerIds.every((id) => Number.isInteger(id) && handles.has(id)) || new Set(playerIds).size !== playerIds.length) {
    return { ok: false, error: 'bad-request' };
  }
  if (playerIds.length < bracketPlayersMin(format)) return { ok: false, error: 'too-few-players' };
  if (playerIds.length > BRACKET_PLAYERS_MAX) return { ok: false, error: 'too-many-players' };

  const state: BracketState = {
    settings: { id: input.id, format, bestOf, stations, createdAt: input.createdAt },
    seeding: seedPlayers(format, playerIds, random),
    lateJoins: [],
    results: [],
    tieBreaks: [],
  };
  const built = await rebuildOrThrow(state);
  return { ok: true, state, bracket: await answerFor(state, built, handles) };
}

export interface NewResult {
  /** The id the caller stores it under; unique within the bracket. */
  id: number;
  matchId: number;
  winnerId: number;
  at: string;
}

/** Records the winner of a match on a station. */
export async function recordResult(state: BracketState, input: NewResult, handles: HandleLookup): Promise<EngineAnswer> {
  const built = await rebuildOrThrow(state);
  const match = built.byId.get(input.matchId);
  if (!match) return { ok: false, error: 'not-found' };
  if (!onStation(built, match.id)) return { ok: false, error: 'not-on-station' };
  const [a, b] = [playerIdOf(match.slots[0]), playerIdOf(match.slots[1])];
  if (input.winnerId !== a && input.winnerId !== b) return { ok: false, error: 'bad-request' };
  if (state.results.some((r) => r.id === input.id)) throw new Error(`result id ${input.id} is already in the log`);

  const loserId = (input.winnerId === a ? b : a) as number;
  const next: BracketState = {
    ...state,
    results: [...state.results, { id: input.id, matchId: match.id, winnerId: input.winnerId, loserId, at: input.at }],
  };
  return { ok: true, state: next, bracket: await answerFor(next, await rebuildOrThrow(next), handles) };
}

export interface UndoInput {
  resultId: number;
  /** ISO 8601; an older undo is logged at this time, and a station it fills is called then. */
  at: string;
}

/**
 * Takes back one result (docs/PLAN.md, "Stations and the queue").
 *
 * The newest log entry comes out of the log, and the bracket is exactly what it was before
 * that result (CLAUDE.md, rule 5), including the match its station called being un-called.
 *
 * An older result stays in the log, marked undone at a new step, so the history of the
 * stations is unchanged: every match on a station keeps its station and its calledAt, and the
 * match reopens at the front of Up next. It is refused (`undo-later-first`) when anything
 * later depends on it: a later result that no longer replays or was recorded off a station, a
 * match on a station that would lose a player, or a tie-break made after it.
 */
export async function undoResult(state: BracketState, input: UndoInput, handles: HandleLookup): Promise<EngineAnswer> {
  const result = state.results.find((r) => r.id === input.resultId && !r.undone);
  if (!result) return { ok: false, error: 'nothing-to-undo' };
  const before = await rebuildOrThrow(state);
  const index = before.log.findIndex((e) => e.kind === 'result' && e.result === result);

  if (index === before.log.length - 1) {
    // Steps count log entries, so a late join made after it moves back one step, and a
    // tie-break made after it was made from a ranking that included it, so it goes too.
    const next: BracketState = {
      ...state,
      results: state.results.filter((r) => r !== result),
      lateJoins: state.lateJoins.map((j) => (j.step > index ? { ...j, step: j.step - 1 } : j)),
      tieBreaks: state.tieBreaks.filter((t) => t.step <= index),
    };
    return { ok: true, state: next, bracket: await answerFor(next, await rebuildOrThrow(next), handles) };
  }

  if (state.tieBreaks.some((t) => t.step > index)) return { ok: false, error: 'undo-later-first' };
  const next: BracketState = {
    ...state,
    results: state.results.map((r) => (r === result ? { ...r, undone: { step: before.log.length, at: input.at } } : r)),
  };
  const after = await rebuild(next);
  if (!after || after.queue.offStation.length > 0) return { ok: false, error: 'undo-later-first' };
  // A station keeps its match, its calledAt, and its two players. An idle station may take
  // the reopened match, and nothing else.
  const kept = before.queue.stations.every((s, i) => {
    const now = after.queue.stations[i];
    if (!now) return false;
    if (s.matchId === null) return now.matchId === null || now.matchId === result.matchId;
    if (now.matchId !== s.matchId || now.calledAt !== s.calledAt) return false;
    return sameSlots(before.byId.get(s.matchId) as EngineMatch, after.byId.get(s.matchId) as EngineMatch);
  });
  if (!kept) return { ok: false, error: 'undo-later-first' };
  return { ok: true, state: next, bracket: await answerFor(next, after, handles) };
}

/** Adds a player after the start, into the first empty slot. */
export async function joinLate(state: BracketState, playerId: number, handles: HandleLookup): Promise<EngineAnswer> {
  if (!handles.has(playerId)) return { ok: false, error: 'not-found' };
  const joined = await tryJoin(state, await rebuildOrThrow(state), playerId);
  if (!joined.ok) return joined;
  return { ok: true, state: joined.state, bracket: await answerFor(joined.state, joined.built, handles) };
}

/** Makes the matches of every tie-break round the answer asks for that aren't made yet. */
export async function startTieBreak(state: BracketState, handles: HandleLookup): Promise<EngineAnswer> {
  const built = await rebuildOrThrow(state);
  const made = new Set(state.tieBreaks.map((t) => `${t.round}:${Math.min(...t.players)}-${Math.max(...t.players)}`));
  const added: TieBreakRecord[] = [];
  for (const needed of built.ranking?.tieBreaks ?? []) {
    for (const [a, b] of needed.pairs) {
      if (made.has(`${needed.round}:${Math.min(a, b)}-${Math.max(a, b)}`)) continue;
      added.push({ round: needed.round, players: [a, b], step: stepNow(state) });
    }
  }
  if (added.length === 0) return { ok: false, error: 'no-tie' };
  const next: BracketState = { ...state, tieBreaks: [...state.tieBreaks, ...added] };
  return { ok: true, state: next, bracket: await answerFor(next, await rebuildOrThrow(next), handles) };
}
