// The heat engine (docs/PLAN.md, "Races and free-for-all", "Ties", "Late sign-up", "Stations
// and the queue", and "Heats API"). Heats are their settings, a seeding list, the late joins,
// the tie-break heats made so far, and the log. Every answer is rebuilt from those by replay:
// round 1 is cut from the seeding, and each later round, the tie-break heats' places, and the
// final are worked out from the results standing at each step, with the rules in
// `packages/core/src/heats.ts`. Undoing the newest result takes it out of the log and gives
// back exactly the heats there were before it (CLAUDE.md, rule 5). Undoing an older result
// adds an undo to the log instead, so every heat being played keeps its station.
//
// It follows `bracket-engine.ts`: each operation takes a state and gives back a new state with
// its answer, or a refusal. Nothing here touches the database or the clock: the caller stores
// the state, passes in the time and the new result's id, and runs one operation at a time.

import {
  FINAL_SIZE,
  HEAT_PLAYERS_MAX,
  HEAT_PLAYERS_MIN,
  HEAT_RACES_MAX,
  HEAT_RACES_MIN,
  HEAT_ROUNDS_MAX,
  HEAT_ROUNDS_MIN,
  HEAT_SIZE_MAX,
  STATIONS_MAX,
  STATIONS_MIN,
  buildQueue,
  cutIntoHeats,
  finalPlaces,
  hasQualifying,
  isFinishOrder,
  isPointsTable,
  lateJoinHeat,
  rankByPoints,
  regroup,
  scoreHeats,
  seedHeats,
  settleCut,
  type ApiErrorCode,
  type FinalCut,
  type Heat,
  type HeatKind,
  type HeatScore,
  type HeatStandingsRow,
  type Heats,
  type Player,
  type QueueMatch,
  type QueueState,
  type RacesPerHeat,
  type RandomSource,
  type RankedGroup,
  type TieBreakHeat,
} from '@coliseumgrid/core';
import type { HandleLookup } from './bracket-engine.ts';

export interface HeatSettings {
  id: number;
  /** 1 to 8, fixed for the life of the heats. */
  stations: number;
  races: RacesPerHeat;
  /** Qualifying rounds, 1 to 3; 0 when 2 to 4 players play only the final. */
  rounds: number;
  /** Points for 1st to 4th (`isPointsTable`). */
  points: number[];
  /** ISO 8601; the first heats are called at this time. */
  createdAt: string;
}

export interface HeatResultRecord {
  id: number;
  heatId: number;
  /** Every player of the heat once, 1st first. */
  order: number[];
  /** ISO 8601; the station it frees is called again at this time. */
  at: string;
  /**
   * Set when an older undo took it back. The result stays in the log, so the stations it
   * freed stay as they were, and the undo is the log entry at `step`.
   */
  undone?: { step: number; at: string };
}

/**
 * A player added after the start, into round 1 heat `heatId`. `step` is the number of log
 * entries when they joined. The heat's place in the queue doesn't change.
 */
export interface HeatLateJoin {
  playerId: number;
  heatId: number;
  step: number;
}

/**
 * A tie-break heat, in the order made. Its heat id is `TIE_BREAK_HEAT_BASE` plus its place in
 * the list, so the list is only ever added to at the end or cut back from the end. Every heat
 * of one tie-break pass is made at one step, and a pass can only be made after the pass
 * before it has every result, so the pass is the count of distinct steps up to it.
 */
export interface HeatTieBreakRecord {
  players: number[];
  /** The number of log entries when it was made. */
  step: number;
}

export interface HeatState {
  settings: HeatSettings;
  /** The on-time players, shuffled. Round 1 is `cutIntoHeats(seeding)`. */
  seeding: number[];
  lateJoins: HeatLateJoin[];
  /**
   * Every result in the order recorded, undone ones included. With the undos (each at its
   * `undone.step`) they make the log: entry k is step k + 1.
   */
  results: HeatResultRecord[];
  tieBreaks: HeatTieBreakRecord[];
}

export type HeatEngineAnswer = { ok: true; state: HeatState; heats: Heats } | { ok: false; error: ApiErrorCode };

/** A qualifying heat's id is `round * ROUND_ID_STEP + number`. */
export const ROUND_ID_STEP = 100;
/** Tie-break heat ids start here, past every qualifying heat (round 3 heat 8 is 308). */
export const TIE_BREAK_HEAT_BASE = 1000;
/** The final's id. */
export const FINAL_HEAT_ID = 2000;

interface EngineHeat {
  id: number;
  kind: HeatKind;
  /** The qualifying round; a tie-break's pass; 1 for the final. */
  round: number;
  number: number;
  players: number[];
}

/** One log entry: a result, or an older undo of `result`. */
type LogEntry = { kind: 'result'; result: HeatResultRecord } | { kind: 'undo'; result: HeatResultRecord; at: string };

/** One replay of a state: everything an answer or a check needs. */
interface Built {
  /** Every heat made, in the order made. */
  heats: EngineHeat[];
  byId: Map<number, EngineHeat>;
  /** The results standing: not undone. */
  resultOf: Map<number, HeatResultRecord>;
  log: LogEntry[];
  queue: QueueState;
  /** On-time players in seeding order, then late players in the order they joined. */
  players: number[];
  /** Points so far, from the qualifying heats with a result. */
  scores: HeatScore[];
  /** The qualifying round being played; null once qualifying is over or when there is none. */
  round: number | null;
  /** Set once every qualifying heat has a result (from the start with 2 to 4 players). */
  cut: FinalCut | null;
}

/**
 * The log in step order: the results in the order recorded, with each older undo at its
 * step. Null if the steps don't fit together, or an undo comes before its result.
 */
function logOf(results: readonly HeatResultRecord[]): LogEntry[] | null {
  const undoAt = new Map<number, HeatResultRecord>();
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
const stepNow = (state: HeatState): number => state.results.length + state.results.filter((r) => r.undone).length;

/** Each tie-break's pass: the count of distinct steps up to and including its own. Null if the steps go backwards. */
function passesOf(tieBreaks: readonly HeatTieBreakRecord[]): number[] | null {
  const passes: number[] = [];
  let pass = 0;
  let last = -1;
  for (const t of tieBreaks) {
    if (t.step < last) return null;
    if (t.step > last) pass += 1;
    last = t.step;
    passes.push(pass);
  }
  return passes;
}

/** What the results standing at one step call for. */
interface Derived {
  heats: EngineHeat[];
  scores: HeatScore[];
  round: number | null;
  cut: FinalCut | null;
}

/** The heats there should be with these results standing and these tie-breaks made. Null when they don't fit together. */
function heatsFor(
  settings: HeatSettings,
  players: readonly number[],
  roundOne: readonly EngineHeat[],
  tieHeats: readonly EngineHeat[],
  standing: ReadonlyMap<number, HeatResultRecord>,
): Derived | null {
  const { rounds, points } = settings;
  const finishes = (heats: readonly EngineHeat[]): number[][] => heats.flatMap((h) => {
    const r = standing.get(h.id);
    return r ? [r.order] : [];
  });
  const allDone = (heats: readonly EngineHeat[]): boolean => heats.every((h) => standing.has(h.id));

  const qualifying: EngineHeat[] = [...roundOne];
  let round: number | null = null;
  if (rounds > 0) {
    round = 1;
    for (let r = 1; r < rounds && allDone(qualifying); r++) {
      // Round r + 1 is cut from the points after round r, so a result in it never moves it.
      const groups = regroup(scoreHeats(players, finishes(qualifying), points));
      qualifying.push(...groups.map((g, i) => ({ id: (r + 1) * ROUND_ID_STEP + i + 1, kind: 'round' as const, round: r + 1, number: i + 1, players: g })));
      round = r + 1;
    }
  }
  const scores = scoreHeats(players, finishes(qualifying), points);
  if (!allDone(qualifying)) {
    // Tie-break heats are made only once qualifying is over.
    if (tieHeats.length > 0) return null;
    return { heats: qualifying, scores, round, cut: null };
  }

  const finalSize = rounds > 0 ? FINAL_SIZE : players.length;
  const made: TieBreakHeat[] = tieHeats.map((h) => ({ pass: h.round, players: h.players, order: standing.get(h.id)?.order ?? null }));
  let cut: FinalCut;
  try {
    cut = settleCut(rankByPoints(scores), made, finalSize);
  } catch (error) {
    // The tie-break heats made don't fit the ranking these results give.
    if (error instanceof RangeError) return null;
    throw error;
  }
  const heats = [...qualifying, ...tieHeats];
  if (cut.finalists) heats.push({ id: FINAL_HEAT_ID, kind: 'final', round: 1, number: 1, players: cut.finalists });
  return { heats, scores, round: null, cut };
}

const samePlayers = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((id, i) => b[i] === id);

/**
 * Replays a state. Null when a logged result no longer fits its heat, or a heat already made
 * would change or go away: an older undo that a later round, a tie-break, or the final was
 * made from.
 */
function rebuild(state: HeatState): Built | null {
  const { settings, seeding, lateJoins, results, tieBreaks } = state;
  const log = logOf(results);
  const passes = passesOf(tieBreaks);
  if (!log || !passes) return null;
  const players = [...seeding, ...lateJoins.map((j) => j.playerId)];

  // Round 1: the seeding cut into heats, with each late player at the end of the heat they
  // joined. With 2 to 4 players there is no round 1, and nobody can join.
  const roundOne: EngineHeat[] = settings.rounds > 0
    ? cutIntoHeats(seeding).map((g, i) => {
        const id = ROUND_ID_STEP + i + 1;
        return { id, kind: 'round', round: 1, number: i + 1, players: [...g, ...lateJoins.filter((j) => j.heatId === id).map((j) => j.playerId)] };
      })
    : [];
  if (lateJoins.some((j) => !roundOne.some((h) => h.id === j.heatId)) || roundOne.some((h) => h.players.length > HEAT_SIZE_MAX)) return null;
  const numberInPass = new Map<number, number>();
  const tieHeats: EngineHeat[] = tieBreaks.map((t, i) => {
    const pass = passes[i] as number;
    const number = (numberInPass.get(pass) ?? 0) + 1;
    numberInPass.set(pass, number);
    return { id: TIE_BREAK_HEAT_BASE + i, kind: 'tie-break', round: pass, number, players: [...t.players] };
  });

  const made: EngineHeat[] = [];
  const madeAt = new Map<number, number>();
  const byId = new Map<number, EngineHeat>();
  const standing = new Map<number, HeatResultRecord>();
  const reopenedAt = new Map<number, number[]>();
  // After each step, the heats the results call for. One made earlier must still be there with
  // the same players; a new one is made at this step. Null when they don't fit.
  const settle = (step: number): Derived | null => {
    const madeBy = tieHeats.filter((h) => (tieBreaks[h.id - TIE_BREAK_HEAT_BASE] as HeatTieBreakRecord).step <= step);
    const now = heatsFor(settings, players, roundOne, madeBy, standing);
    if (!now) return null;
    const ids = new Map(now.heats.map((h) => [h.id, h]));
    if (made.some((h) => !ids.has(h.id) || !samePlayers(h.players, (ids.get(h.id) as EngineHeat).players))) return null;
    for (const h of now.heats) {
      if (byId.has(h.id)) continue;
      made.push(h);
      byId.set(h.id, h);
      madeAt.set(h.id, step);
    }
    return now;
  };

  let now = settle(0);
  if (!now) return null;
  for (const [index, e] of log.entries()) {
    const heat = byId.get(e.result.heatId);
    if (!heat) return null;
    if (e.kind === 'result') {
      if (standing.has(heat.id) || !isFinishOrder(heat.players, e.result.order)) return null;
      standing.set(heat.id, e.result);
    } else {
      if (standing.get(heat.id) !== e.result) return null;
      standing.delete(heat.id);
      // Ready again from the step after the undo, ahead of every heat not reopened.
      reopenedAt.set(heat.id, [...(reopenedAt.get(heat.id) ?? []), index + 1]);
    }
    now = settle(index + 1);
    if (!now) return null;
  }
  // A tie-break made after the last step was never placed.
  if (tieHeats.some((h) => !byId.has(h.id))) return null;

  const queueMatches: QueueMatch[] = [];
  for (const h of made) {
    const entry = { id: h.id, round: h.round, number: h.number, players: h.players, firstRound: false, hasByePlayer: false };
    queueMatches.push({ ...entry, readyStep: madeAt.get(h.id) as number });
    for (const step of reopenedAt.get(h.id) ?? []) queueMatches.push({ ...entry, readyStep: step, reopened: true });
  }
  const queue = buildQueue({
    stations: settings.stations,
    createdAt: settings.createdAt,
    matches: queueMatches,
    results: log.map((e) => (e.kind === 'result' ? { matchId: e.result.heatId, at: e.result.at } : { matchId: null, at: e.at })),
  });

  return { heats: made, byId, resultOf: standing, log, queue, players, scores: now.scores, round: now.round, cut: now.cut };
}

function rebuildOrThrow(state: HeatState): Built {
  const built = rebuild(state);
  if (!built) throw new Error(`heats ${state.settings.id}: the stored result log does not replay`);
  return built;
}

const onStation = (built: Built, heatId: number): boolean => built.queue.stations.some((s) => s.matchId === heatId);

/** Every station keeps its heat, `calledAt`, and players; an idle station may take only a heat `mayTake` allows. */
function stationsKept(before: Built, after: Built, mayTake: (heatId: number) => boolean): boolean {
  return before.queue.stations.every((s, i) => {
    const now = after.queue.stations[i];
    if (!now) return false;
    if (s.matchId === null) return now.matchId === null || mayTake(now.matchId);
    if (now.matchId !== s.matchId || now.calledAt !== s.calledAt) return false;
    return samePlayers((before.byId.get(s.matchId) as EngineHeat).players, (after.byId.get(s.matchId) as EngineHeat).players);
  });
}

function buildAnswer(state: HeatState, built: Built, handles: HandleLookup, lateOpen: boolean): Heats {
  const player = (id: number): Player => {
    const handle = handles.get(id);
    if (handle === undefined) throw new Error(`heats ${state.settings.id}: no handle for player ${id}`);
    return { id, handle };
  };
  const heatView = (h: EngineHeat): Heat => {
    const result = built.resultOf.get(h.id);
    let status: Heat['status'] = 'ready';
    if (result) status = 'done';
    else if (onStation(built, h.id)) status = 'playing';
    return {
      id: h.id,
      kind: h.kind,
      round: h.round,
      number: h.number,
      status,
      players: h.players.map(player),
      order: result ? result.order.map(player) : null,
      resultId: result ? result.id : null,
    };
  };
  const views = new Map(built.heats.map((h) => [h.id, heatView(h)]));
  const viewOf = (id: number): Heat => views.get(id) as Heat;

  // Qualifying order, refined by any tie-break at the cut, then the final's own order on top.
  let ranking: RankedGroup[] = rankByPoints(built.scores);
  if (built.cut) {
    const final = built.resultOf.get(FINAL_HEAT_ID);
    ranking = finalPlaces(built.cut.ranking, final ? final.order : null);
  }
  const scoreOf = new Map(built.scores.map((s) => [s.player, s]));
  const row = (place: number, id: number): HeatStandingsRow => {
    const score = scoreOf.get(id) as HeatScore;
    return { place, player: player(id), points: score.points, heatsPlayed: score.heatsPlayed };
  };
  const tie = built.cut?.tie;

  // The newest result standing: what a recorded result answers with, and what to undo last.
  const lastResult = state.results.filter((r) => !r.undone).at(-1);
  return {
    id: state.settings.id,
    races: state.settings.races,
    rounds: state.settings.rounds,
    points: [...state.settings.points],
    finished: built.resultOf.has(FINAL_HEAT_ID),
    lateOpen,
    lastResultId: lastResult ? lastResult.id : null,
    round: built.round,
    stations: built.queue.stations.map((s) => ({ number: s.number, heat: s.matchId === null ? null : viewOf(s.matchId), calledAt: s.calledAt })),
    upNext: built.queue.upNext.map(viewOf),
    heats: built.heats.map((h) => viewOf(h.id)),
    standings: ranking.flatMap((g) => g.players.map((id) => row(g.place, id))),
    finalSize: state.settings.rounds > 0 ? FINAL_SIZE : built.players.length,
    ties: tie ? [{ place: tie.place, players: tie.players.map(player), started: tie.started }] : [],
  };
}

/**
 * A late player joins the smallest round 1 heat still waiting with room, the lowest number
 * on a tie (docs/PLAN.md, "Late sign-up"). Waiting means never called: not on a station, and
 * no result, standing or undone. Refused once round 1 is finished, when no heat is waiting
 * with room, or when any heat on a station would change.
 */
function tryJoin(state: HeatState, built: Built, playerId: number): { ok: true; state: HeatState; built: Built } | { ok: false; error: ApiErrorCode } {
  if (built.players.includes(playerId)) return { ok: false, error: 'already-in' };
  const roundOne = built.heats.filter((h) => h.kind === 'round' && h.round === 1);
  if (roundOne.every((h) => built.resultOf.has(h.id))) return { ok: false, error: 'late-closed' };
  const played = new Set(state.results.map((r) => r.heatId));
  const heatId = lateJoinHeat(
    roundOne.map((h) => ({ id: h.id, number: h.number, size: h.players.length, waiting: !played.has(h.id) && !onStation(built, h.id) })),
  );
  if (heatId === null) return { ok: false, error: 'late-closed' };
  const next: HeatState = { ...state, lateJoins: [...state.lateJoins, { playerId, heatId, step: stepNow(state) }] };
  const after = rebuild(next);
  if (!after || after.queue.offStation.length > 0 || !stationsKept(built, after, (id) => id === heatId)) return { ok: false, error: 'late-closed' };
  return { ok: true, state: next, built: after };
}

/** No real player has a negative id, so this stands in for "anyone" when asking if a join would pass. */
const ANY_PLAYER = -1;

function answerFor(state: HeatState, built: Built, handles: HandleLookup): Heats {
  return buildAnswer(state, built, handles, tryJoin(state, built, ANY_PLAYER).ok);
}

/** The answer for stored heats. Throws if the stored log doesn't replay, which is a bug. */
export function heatsAnswer(state: HeatState, handles: HandleLookup): Heats {
  return answerFor(state, rebuildOrThrow(state), handles);
}

export interface NewHeats {
  id: number;
  stations: number;
  races: number;
  /** 1 to 3; with 2 to 4 players any of 0 to 3 is taken and stored as 0. */
  rounds: number;
  points: number[];
  playerIds: number[];
  createdAt: string;
}

const inRange = (value: number, min: number, max: number): boolean => Number.isInteger(value) && value >= min && value <= max;

/** Makes heats with a random seeding from `random`. */
export function createHeats(input: NewHeats, random: RandomSource, handles: HandleLookup): HeatEngineAnswer {
  const { stations, races, rounds, points, playerIds } = input;
  if (!inRange(stations, STATIONS_MIN, STATIONS_MAX) || !inRange(races, HEAT_RACES_MIN, HEAT_RACES_MAX)) return { ok: false, error: 'bad-request' };
  if (!inRange(rounds, 0, HEAT_ROUNDS_MAX) || !isPointsTable(points)) return { ok: false, error: 'bad-request' };
  if (!playerIds.every((id) => Number.isInteger(id) && handles.has(id)) || new Set(playerIds).size !== playerIds.length) {
    return { ok: false, error: 'bad-request' };
  }
  if (playerIds.length < HEAT_PLAYERS_MIN) return { ok: false, error: 'too-few-players' };
  if (playerIds.length > HEAT_PLAYERS_MAX) return { ok: false, error: 'too-many-players' };
  const qualifying = hasQualifying(playerIds.length);
  if (qualifying && rounds < HEAT_ROUNDS_MIN) return { ok: false, error: 'bad-request' };

  const state: HeatState = {
    settings: { id: input.id, stations, races: races as RacesPerHeat, rounds: qualifying ? rounds : 0, points: [...points], createdAt: input.createdAt },
    seeding: seedHeats(playerIds, random),
    lateJoins: [],
    results: [],
    tieBreaks: [],
  };
  return { ok: true, state, heats: answerFor(state, rebuildOrThrow(state), handles) };
}

export interface NewHeatResult {
  /** The id the caller stores it under; unique within the heats. */
  id: number;
  heatId: number;
  /** Every player of the heat once, 1st first. */
  order: number[];
  at: string;
}

/** Records the finishing order of a heat on a station. */
export function recordHeatResult(state: HeatState, input: NewHeatResult, handles: HandleLookup): HeatEngineAnswer {
  const built = rebuildOrThrow(state);
  const heat = built.byId.get(input.heatId);
  if (!heat) return { ok: false, error: 'not-found' };
  if (!onStation(built, heat.id)) return { ok: false, error: 'not-on-station' };
  if (!Array.isArray(input.order) || !isFinishOrder(heat.players, input.order)) return { ok: false, error: 'bad-request' };
  if (state.results.some((r) => r.id === input.id)) throw new Error(`result id ${input.id} is already in the log`);

  const next: HeatState = { ...state, results: [...state.results, { id: input.id, heatId: heat.id, order: [...input.order], at: input.at }] };
  return { ok: true, state: next, heats: answerFor(next, rebuildOrThrow(next), handles) };
}

export interface HeatUndoInput {
  resultId: number;
  /** ISO 8601; an older undo is logged at this time, and a station it fills is called then. */
  at: string;
}

/**
 * Takes back one result (docs/PLAN.md, "Stations and the queue").
 *
 * The newest log entry comes out of the log, and the heats are exactly what they were before
 * that result (CLAUDE.md, rule 5): a round, tie-break, or final it completed goes away, and
 * the heat its station called goes back to Up next.
 *
 * An older result stays in the log, marked undone at a new step, so the history of the
 * stations is unchanged: every heat on a station keeps its station and its calledAt, and the
 * heat reopens at the front of Up next. It is refused (`undo-later-first`) when anything
 * later depends on it: a later round, a tie-break heat, or the final made after it, or a heat
 * on a station that would change.
 */
export function undoHeatResult(state: HeatState, input: HeatUndoInput, handles: HandleLookup): HeatEngineAnswer {
  const result = state.results.find((r) => r.id === input.resultId && !r.undone);
  if (!result) return { ok: false, error: 'nothing-to-undo' };
  const before = rebuildOrThrow(state);
  const index = before.log.findIndex((e) => e.kind === 'result' && e.result === result);

  if (index === before.log.length - 1) {
    // Steps count log entries, so a late join made after it moves back one step, and a
    // tie-break made after it was made from a ranking that included it, so it goes too.
    const next: HeatState = {
      ...state,
      results: state.results.filter((r) => r !== result),
      lateJoins: state.lateJoins.map((j) => (j.step > index ? { ...j, step: j.step - 1 } : j)),
      tieBreaks: state.tieBreaks.filter((t) => t.step <= index),
    };
    return { ok: true, state: next, heats: answerFor(next, rebuildOrThrow(next), handles) };
  }

  if (state.tieBreaks.some((t) => t.step > index)) return { ok: false, error: 'undo-later-first' };
  const next: HeatState = {
    ...state,
    results: state.results.map((r) => (r === result ? { ...r, undone: { step: before.log.length, at: input.at } } : r)),
  };
  // The replay refuses a later round or the final that the undone result was needed for.
  const after = rebuild(next);
  if (!after || after.queue.offStation.length > 0 || !stationsKept(before, after, (id) => id === result.heatId)) {
    return { ok: false, error: 'undo-later-first' };
  }
  return { ok: true, state: next, heats: answerFor(next, after, handles) };
}

/** Adds a player after the start, into the smallest round 1 heat still waiting with room. */
export function joinHeatsLate(state: HeatState, playerId: number, handles: HandleLookup): HeatEngineAnswer {
  if (!handles.has(playerId)) return { ok: false, error: 'not-found' };
  const joined = tryJoin(state, rebuildOrThrow(state), playerId);
  if (!joined.ok) return joined;
  return { ok: true, state: joined.state, heats: answerFor(joined.state, joined.built, handles) };
}

/** Makes the tie-break heats of the pass the cut for the final is waiting on. */
export function startHeatTieBreak(state: HeatState, handles: HandleLookup): HeatEngineAnswer {
  const tie = rebuildOrThrow(state).cut?.tie;
  if (!tie || tie.started) return { ok: false, error: 'no-tie' };
  const step = stepNow(state);
  const next: HeatState = { ...state, tieBreaks: [...state.tieBreaks, ...tie.heats.map((players) => ({ players: [...players], step }))] };
  return { ok: true, state: next, heats: answerFor(next, rebuildOrThrow(next), handles) };
}
