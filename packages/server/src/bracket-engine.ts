// The bracket engine (docs/PLAN.md, "1 vs 1 bracket", "Ties", "Late sign-up", "Stations and
// the queue", and "Brackets API"). A bracket is its settings, a seeding list, the late
// joins, the result log, and the tie-break matches made so far. Every answer is rebuilt
// from those by replay, so an undo is the log without that result and gives back exactly
// the bracket it had before (CLAUDE.md, rule 5).
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
import { replayLibrary, type LibraryMatch, type LibrarySlot } from './bracket-library.ts';

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
}

/** A player added after the start. `step` is the number of results logged when they joined. */
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
  /** The number of results logged when it was made. */
  step: number;
}

export interface BracketState {
  settings: BracketSettings;
  /** Player ids in starting-spot order, nulls for empty slots; late players fill nulls. */
  seeding: Array<number | null>;
  lateJoins: LateJoin[];
  /** In the order recorded. */
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
  /** After late joins are applied; null if both players were never known. */
  readyStep: number | null;
  /** Its readyStep was set by a late player joining. */
  late: boolean;
}

/** One replay of a state: everything an answer or a check needs. */
interface Built {
  /** The matches in the answer: the library's (less an unneeded rematch), then tie-breaks. */
  matches: EngineMatch[];
  byId: Map<number, EngineMatch>;
  resultOf: Map<number, BracketResultRecord>;
  queue: QueueState;
  /** Round robin only. */
  ranking: RoundRobinRanking | null;
}

const playerIdOf = (slot: EngineSlot): number | null => (slot.kind === 'player' ? slot.id : null);
const isBye = (m: EngineMatch): boolean => m.slots[0].kind === 'bye' || m.slots[1].kind === 'bye';
const sameSlots = (a: EngineMatch, b: EngineMatch): boolean =>
  playerIdOf(a.slots[0]) === playerIdOf(b.slots[0]) && playerIdOf(a.slots[1]) === playerIdOf(b.slots[1]);

/** Replays a state. Null when a logged result no longer fits its match. */
async function rebuild(state: BracketState): Promise<Built | null> {
  const { settings, seeding, lateJoins, results, tieBreaks } = state;
  const libraryResults = results.flatMap((r, step) =>
    r.matchId < TIE_BREAK_ID_BASE ? [{ step, matchId: r.matchId, winnerId: r.winnerId, loserId: r.loserId }] : [],
  );
  const replay = await replayLibrary(settings.format, seeding, libraryResults);
  if (!replay.ok) return null;
  if (replay.matches.some((m) => m.id >= TIE_BREAK_ID_BASE)) throw new Error('library match ids reach the tie-break ids');

  const resultOf = new Map<number, BracketResultRecord>();
  for (const r of results) resultOf.set(r.matchId, r);

  // Tie-break results: the match must have been made before the result, and the winner and
  // loser must be its two players.
  for (const [step, r] of results.entries()) {
    if (r.matchId < TIE_BREAK_ID_BASE) continue;
    const made = tieBreaks[r.matchId - TIE_BREAK_ID_BASE];
    if (!made || made.step > step || results.findIndex((x) => x.matchId === r.matchId) !== step) return null;
    const [a, b] = made.players;
    if (!((r.winnerId === a && r.loserId === b) || (r.winnerId === b && r.loserId === a))) return null;
  }

  // The rematch for the title counts only when the player from the losers' side won the
  // first final (opponent2). Otherwise it is left out of the answer.
  const final = replay.matches.find((m) => m.side === 'final');
  const finalResult = final && resultOf.get(final.id);
  const rematchUnneeded = final !== undefined && finalResult !== undefined && finalResult.winnerId === playerIdOf(final.slots[0]);

  const joinStep = new Map(lateJoins.map((j) => [j.playerId, j.step]));
  const fromLibrary = (m: LibraryMatch): EngineMatch => {
    const joined = Math.max(-1, ...m.slots.map((s) => (s.kind === 'player' ? (joinStep.get(s.id) ?? -1) : -1)));
    const readyStep = m.readyStep === null ? null : Math.max(m.readyStep, joined);
    return {
      id: m.id,
      side: m.side,
      round: m.round,
      number: m.number,
      slots: m.slots,
      readyStep,
      late: m.readyStep !== null && joined >= m.readyStep,
    };
  };
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
      readyStep: t.step,
      late: false,
    };
  };
  const matches = [
    ...replay.matches.filter((m) => !(m.side === 'rematch' && rematchUnneeded)).map(fromLibrary),
    ...tieBreaks.map(fromTieBreak),
  ];
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
  const queueMatches: QueueMatch[] = [];
  for (const m of matches) {
    const a = playerIdOf(m.slots[0]);
    const b = playerIdOf(m.slots[1]);
    if (m.readyStep === null || a === null || b === null) continue;
    queueMatches.push({
      id: m.id,
      round: m.round,
      number: m.number,
      players: [a, b],
      readyStep: m.readyStep,
      late: m.late,
      firstRound: firstRound(m),
      hasByePlayer: byePlayers.has(a) || byePlayers.has(b),
    });
  }
  const queue = buildQueue({
    stations: settings.stations,
    createdAt: settings.createdAt,
    matches: queueMatches,
    results: results.map((r) => ({ matchId: r.matchId, at: r.at })),
  });

  let ranking: RoundRobinRanking | null = null;
  if (settings.format === 'round_robin') {
    const players = seeding.filter((id): id is number => id !== null);
    const main = results.filter((r) => r.matchId < TIE_BREAK_ID_BASE).map((r) => ({ winner: r.winnerId, loser: r.loserId }));
    const extra = results
      .filter((r) => r.matchId >= TIE_BREAK_ID_BASE)
      .map((r) => ({ winner: r.winnerId, loser: r.loserId, round: (byId.get(r.matchId) as EngineMatch).round }));
    ranking = rankRoundRobin(players, main, extra);
  }

  return { matches, byId, resultOf, queue, ranking };
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
    else if (m.readyStep !== null) status = 'ready';
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

  // Wins and losses count every match played in this bracket, tie-breaks included.
  const wins = new Map<number, number>();
  const losses = new Map<number, number>();
  for (const r of state.results) {
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

  const lastResult = state.results.at(-1);
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
  const next: BracketState = { ...state, seeding, lateJoins: [...state.lateJoins, { playerId, step: state.results.length }] };
  const after = await rebuild(next);
  if (!after) return { ok: false, error: 'late-closed' };
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

/**
 * Removes one result. The newest always comes off. An older one comes off only when every
 * later result still replays with the same two players and was on a station when it was
 * recorded (docs/PLAN.md, "Stations and the queue"); otherwise `undo-later-first`.
 */
export async function undoResult(state: BracketState, resultId: number, handles: HandleLookup): Promise<EngineAnswer> {
  const index = state.results.findIndex((r) => r.id === resultId);
  if (index === -1) return { ok: false, error: 'nothing-to-undo' };

  // Steps count results, so a late join made after the removed result moves back one step.
  // A tie-break made after it was made from a ranking that included it, so it goes too.
  const tieBreaks = state.tieBreaks.filter((t) => t.step <= index);
  const next: BracketState = {
    ...state,
    results: state.results.filter((_, i) => i !== index),
    lateJoins: state.lateJoins.map((j) => (j.step > index ? { ...j, step: j.step - 1 } : j)),
    tieBreaks,
  };
  const removedTieBreak = (id: number): boolean => id >= TIE_BREAK_ID_BASE + tieBreaks.length;
  if (next.results.some((r) => removedTieBreak(r.matchId))) return { ok: false, error: 'undo-later-first' };
  const built = await rebuild(next);
  if (!built || built.queue.offStation.length > 0) return { ok: false, error: 'undo-later-first' };
  return { ok: true, state: next, bracket: await answerFor(next, built, handles) };
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
      added.push({ round: needed.round, players: [a, b], step: state.results.length });
    }
  }
  if (added.length === 0) return { ok: false, error: 'no-tie' };
  const next: BracketState = { ...state, tieBreaks: [...state.tieBreaks, ...added] };
  return { ok: true, state: next, bracket: await answerFor(next, await rebuildOrThrow(next), handles) };
}
