// Which match is on which station, and who is up next (docs/PLAN.md, "Stations and the
// queue"). Nothing here is stored: the server replays the result log, notes the step at
// which each match became ready, and calls `buildQueue` with the whole history. The same
// log gives the same stations, so an undo restores them exactly.
//
// A step is a count of results: step 0 is the bracket as created, step k is the bracket
// after its k-th result. Times are strings the caller passes through (the server uses ISO 8601
// in UTC, which sorts as text), so this file never reads a clock. The one thing it does with
// two times is take the later (`QueueMatch.readyAt`).

import { STATIONS_MAX, STATIONS_MIN } from './bracket-seeding.ts';

/**
 * A match that has been ready (both players known, no result) from some step. A match that
 * was ready more than once, because an older undo reopened it or took a player away, has
 * one entry for each time, and the times never overlap.
 */
export interface QueueMatch {
  id: number;
  round: number;
  number: number;
  /**
   * Two for a bracket match; 2 to 4 for a heat (docs/PLAN.md, "Races and free-for-all"),
   * which shares this queue.
   */
  players: readonly number[];
  /**
   * The step at which the match became ready. A late player's matches carry the step at
   * which the player joined, so they queue behind matches that were already waiting.
   */
  readyStep: number;
  /**
   * The time the match was made, for a match made some time after the result that opened its
   * step: a tie-break is made when the host presses Play tie-break, after the last result. A
   * station it fills is called at this time, or at the time of the step when that is later
   * (the station only came free then). Left out, the station is called at the step's time.
   */
  readyAt?: string;
  /**
   * Its readyStep is the step a late player joined. It goes behind matches that became ready
   * at that same step, because those were called, or queued, before the player joined.
   */
  late?: boolean;
  /**
   * An older undo reopened it at `readyStep`. It goes ahead of every match that wasn't
   * reopened, so it takes the next free station.
   */
  reopened?: boolean;
  /**
   * The step at which it stopped being ready without a result: an older undo took away one
   * of its players. It leaves the queue then, and its station if it had one.
   */
  until?: number;
  /** In the first round of play, the round a bye skips. Never true for a round robin. */
  firstRound: boolean;
  /**
   * One of the players had a bye in the first round. These matches wait until every
   * first-round match has a result, so the byes stay open for a late player. A reopened
   * first-round match doesn't count.
   */
  hasByePlayer: boolean;
}

/** One log entry. */
export interface QueueResult {
  /** The match it records a result for; null for an older undo, which records none. */
  matchId: number | null;
  /** The time of the entry. A station free after it is called at this time. */
  at: string;
}

export interface QueueInput {
  /** 1 to 8. */
  stations: number;
  /** The time of step 0, when the first stations are filled. */
  createdAt: string;
  matches: readonly QueueMatch[];
  /** Every log entry in order: entry k makes step k + 1. */
  results: readonly QueueResult[];
}

export interface StationSlot {
  /** From 1. */
  number: number;
  matchId: number | null;
  calledAt: string | null;
}

export interface QueueState {
  stations: StationSlot[];
  /** Matches that will be called next, in order. A player still on a station is skipped when the station is filled. */
  upNext: number[];
  /**
   * Results whose match was not on a station when it was recorded. A log from the live
   * bracket never has any; a change the server is trying out (an undo or a late join) can
   * leave some, and the server then refuses it, because a later result depended on it.
   */
  offStation: number[];
}

/**
 * Reopened first, then earliest ready, a late player's match last among those, then round,
 * number, and id.
 */
function byQueue(a: QueueMatch, b: QueueMatch): number {
  return (
    Number(b.reopened === true) - Number(a.reopened === true) ||
    a.readyStep - b.readyStep ||
    Number(a.late === true) - Number(b.late === true) ||
    a.round - b.round ||
    a.number - b.number ||
    a.id - b.id
  );
}

export function buildQueue(input: QueueInput): QueueState {
  const { stations: count, createdAt, matches, results } = input;
  if (!Number.isInteger(count) || count < STATIONS_MIN || count > STATIONS_MAX) {
    throw new RangeError(`stations must be ${STATIONS_MIN} to ${STATIONS_MAX}, got ${count}`);
  }
  const queue = [...matches].sort(byQueue);
  const stations: StationSlot[] = Array.from({ length: count }, (_, i) => ({ number: i + 1, matchId: null, calledAt: null }));
  // The entry each station holds, by station index; an entry's players are that time's.
  const held: Array<QueueMatch | null> = stations.map(() => null);
  const done = new Set<QueueMatch>();
  const offStation: number[] = [];

  const live = (m: QueueMatch, step: number): boolean =>
    m.readyStep <= step && (m.until === undefined || step < m.until) && !done.has(m);
  const free = (index: number): void => {
    held[index] = null;
    (stations[index] as StationSlot).matchId = null;
    (stations[index] as StationSlot).calledAt = null;
  };

  // Matches that could be called at `step`, in queue order: ready, not on a station, and
  // not held back for a late player. A reopened first-round match doesn't hold anything back:
  // round 1 was finished once, and the matches after it may already be on stations.
  const waitingAt = (step: number): QueueMatch[] => {
    const onStation = new Set(stations.map((s) => s.matchId));
    const firstRoundOpen = queue.some((m) => m.firstRound && m.reopened !== true && live(m, step));
    return queue.filter((m) => live(m, step) && !onStation.has(m.id) && !(m.hasByePlayer && firstRoundOpen));
  };

  // Every idle station, lowest number first, takes the first waiting match none of whose
  // players is on another station. A round robin has all its matches ready at once, so without
  // the check one player could be called to two stations.
  const fill = (step: number, at: string): void => {
    stations.forEach((station, index) => {
      if (held[index]) return;
      const busy = new Set(held.flatMap((m) => (m ? [...m.players] : [])));
      const next = waitingAt(step).find((m) => m.players.every((id) => !busy.has(id)));
      if (next) {
        held[index] = next;
        station.matchId = next.id;
        station.calledAt = next.readyAt !== undefined && next.readyAt > at ? next.readyAt : at;
      }
    });
  };

  fill(0, createdAt);
  results.forEach((result, index) => {
    const step = index + 1;
    if (result.matchId !== null) {
      const at = held.findIndex((m) => m?.id === result.matchId);
      if (at >= 0) {
        done.add(held[at] as QueueMatch);
        free(at);
      } else {
        offStation.push(result.matchId);
        const entry = queue.find((m) => m.id === result.matchId && live(m, index));
        if (entry) done.add(entry);
      }
    }
    // A match no longer ready leaves its station. The server refuses the undo that does this.
    held.forEach((m, at) => {
      if (m && m.until !== undefined && m.until <= step) free(at);
    });
    fill(step, result.at);
  });

  return { stations, upNext: waitingAt(results.length).map((m) => m.id), offStation };
}
