// Which match is on which station, and who is up next (docs/PLAN.md, "Stations and the
// queue"). Nothing here is stored: the server replays the result log, notes the step at
// which each match became ready, and calls `buildQueue` with the whole history. The same
// log gives the same stations, so an undo restores them exactly.
//
// A step is a count of results: step 0 is the bracket as created, step k is the bracket
// after its k-th result. Times are opaque strings the caller passes through (the server
// uses ISO 8601), so this file never reads a clock.

import { STATIONS_MAX, STATIONS_MIN } from './bracket-seeding.ts';

/** A match that has been ready (both players known, no result) at some step. */
export interface QueueMatch {
  id: number;
  round: number;
  number: number;
  players: readonly [number, number];
  /**
   * The step at which the match became ready. A late player's matches carry the step at
   * which the player joined, so they queue behind matches that were already waiting.
   */
  readyStep: number;
  /** In the first round of play, the round a bye skips. Never true for a round robin. */
  firstRound: boolean;
  /**
   * One of the players had a bye in the first round. These matches wait until every
   * first-round match has a result, so the byes stay open for a late player.
   */
  hasByePlayer: boolean;
}

export interface QueueResult {
  matchId: number;
  /** The time the host recorded it. A station it frees is called again at this time. */
  at: string;
}

export interface QueueInput {
  /** 1 to 8. */
  stations: number;
  /** The time of step 0, when the first stations are filled. */
  createdAt: string;
  matches: readonly QueueMatch[];
  /** In the order they were recorded. */
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
   * bracket never has any; an undo of an older result can leave some, and the server must
   * then refuse it, because a later result depended on the one removed.
   */
  offStation: number[];
}

/** Earliest ready first, then round, then number, then id so the order is total. */
function byQueue(a: QueueMatch, b: QueueMatch): number {
  return a.readyStep - b.readyStep || a.round - b.round || a.number - b.number || a.id - b.id;
}

export function buildQueue(input: QueueInput): QueueState {
  const { stations: count, createdAt, matches, results } = input;
  if (!Number.isInteger(count) || count < STATIONS_MIN || count > STATIONS_MAX) {
    throw new RangeError(`stations must be ${STATIONS_MIN} to ${STATIONS_MAX}, got ${count}`);
  }
  const queue = [...matches].sort(byQueue);
  const stations: StationSlot[] = Array.from({ length: count }, (_, i) => ({ number: i + 1, matchId: null, calledAt: null }));
  const done = new Set<number>();
  const offStation: number[] = [];

  // Matches that could be called at `step`, in queue order: not done, not on a station, and
  // not held back for a late player.
  const waitingAt = (step: number): QueueMatch[] => {
    const onStation = new Set(stations.map((s) => s.matchId));
    const firstRoundOpen = queue.some((m) => m.firstRound && m.readyStep <= step && !done.has(m.id));
    return queue.filter(
      (m) => m.readyStep <= step && !done.has(m.id) && !onStation.has(m.id) && !(m.hasByePlayer && firstRoundOpen),
    );
  };

  // Every idle station, lowest number first, takes the first waiting match whose players are
  // both free. A round robin has all its matches ready at once, so without the check one
  // player could be called to two stations.
  const fill = (step: number, at: string): void => {
    for (const station of stations) {
      if (station.matchId !== null) continue;
      const busy = new Set<number>();
      for (const s of stations) {
        const held = matches.find((m) => m.id === s.matchId);
        if (held) held.players.forEach((p) => busy.add(p));
      }
      const next = waitingAt(step).find((m) => !busy.has(m.players[0]) && !busy.has(m.players[1]));
      if (next) {
        station.matchId = next.id;
        station.calledAt = at;
      }
    }
  };

  fill(0, createdAt);
  results.forEach((result, index) => {
    const station = stations.find((s) => s.matchId === result.matchId);
    if (station) {
      station.matchId = null;
      station.calledAt = null;
    } else {
      offStation.push(result.matchId);
    }
    done.add(result.matchId);
    fill(index + 1, result.at);
  });

  return { stations, upNext: waitingAt(results.length).map((m) => m.id), offStation };
}
