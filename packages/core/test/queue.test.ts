// Stations and the queue (src/queue.ts). The matches are written out the way the server will
// produce them from a replay: when each became ready, and who plays.

import { describe, expect, it } from 'vitest';
import { buildQueue, type QueueMatch } from '../src/index.ts';

const T0 = '2027-07-10T14:00:00.000Z';
const T1 = '2027-07-10T14:07:00.000Z';
const T2 = '2027-07-10T14:15:00.000Z';
const T3 = '2027-07-10T14:20:00.000Z';

function match(id: number, round: number, number: number, players: [number, number], extra: Partial<QueueMatch> = {}): QueueMatch {
  return { id, round, number, players, readyStep: 0, firstRound: false, hasByePlayer: false, ...extra };
}

const slots = (state: ReturnType<typeof buildQueue>) => state.stations.map((s) => [s.number, s.matchId, s.calledAt]);

describe('buildQueue: one station, 4 players', () => {
  const matches = [
    match(1, 1, 1, [1, 2], { firstRound: true }),
    match(2, 1, 2, [3, 4], { firstRound: true }),
    match(3, 2, 1, [1, 3], { readyStep: 2 }),
  ];

  it('fills the station at creation and queues the rest', () => {
    const state = buildQueue({ stations: 1, createdAt: T0, matches, results: [] });
    expect(slots(state)).toEqual([[1, 1, T0]]);
    expect(state.upNext).toEqual([2]);
  });

  it('calls the next match at the time of the result that freed the station', () => {
    const state = buildQueue({ stations: 1, createdAt: T0, matches, results: [{ matchId: 1, at: T1 }] });
    expect(slots(state)).toEqual([[1, 2, T1]]);
    expect(state.upNext).toEqual([]);
  });

  it('calls a match that became ready later once its feeders are done', () => {
    const results = [{ matchId: 1, at: T1 }, { matchId: 2, at: T2 }];
    const state = buildQueue({ stations: 1, createdAt: T0, matches, results });
    expect(slots(state)).toEqual([[1, 3, T2]]);
  });

  it('leaves the station empty when nothing is left', () => {
    const results = [{ matchId: 1, at: T1 }, { matchId: 2, at: T2 }, { matchId: 3, at: T3 }];
    const state = buildQueue({ stations: 1, createdAt: T0, matches, results });
    expect(slots(state)).toEqual([[1, null, null]]);
    expect(state.upNext).toEqual([]);
    expect(state.offStation).toEqual([]);
  });

  it('gives the same answer for the same log, and an undo gives back the earlier answer', () => {
    const log = [{ matchId: 1, at: T1 }, { matchId: 2, at: T2 }];
    const input = { stations: 1, createdAt: T0, matches };
    const before = buildQueue({ ...input, results: log.slice(0, 1) });
    buildQueue({ ...input, results: log });
    expect(buildQueue({ ...input, results: log.slice(0, 1) })).toEqual(before);
  });
});

describe('buildQueue: order', () => {
  it('goes by the step ready, then round, then number, then id', () => {
    const matches = [
      match(9, 1, 1, [1, 2], { readyStep: 1 }),
      match(8, 2, 1, [3, 4]),
      match(7, 1, 2, [5, 6]),
      match(6, 1, 2, [7, 8]),
      match(5, 1, 1, [9, 10]),
    ];
    // Step 0 matches in order: 5 (round 1, number 1), 6 (round 1, number 2, lower id), 7, 8.
    const state = buildQueue({ stations: 2, createdAt: T0, matches, results: [] });
    expect(state.stations.map((s) => s.matchId)).toEqual([5, 6]);
    expect(state.upNext).toEqual([7, 8]);
  });

  it('queues a late player behind matches that were already waiting', () => {
    const matches = [
      match(1, 1, 1, [1, 2]),
      match(2, 1, 2, [3, 4]),
      match(3, 1, 1, [5, 6], { readyStep: 1 }),
    ];
    // Match 3 has the lowest round and number, but it was ready only after the first result.
    const state = buildQueue({ stations: 1, createdAt: T0, matches, results: [{ matchId: 1, at: T1 }] });
    expect(slots(state)).toEqual([[1, 2, T1]]);
    expect(state.upNext).toEqual([3]);
  });

  it('puts a late match behind one that became ready at the same step', () => {
    // A late player joined after the first result. Match 4 became ready from that result and
    // was called then; the late match 3 must not take its station.
    const matches = [
      match(1, 1, 1, [1, 2]),
      match(3, 1, 2, [5, 6], { readyStep: 1, late: true }),
      match(4, 2, 1, [1, 7], { readyStep: 1 }),
    ];
    const state = buildQueue({ stations: 1, createdAt: T0, matches, results: [{ matchId: 1, at: T1 }] });
    expect(slots(state)).toEqual([[1, 4, T1]]);
    expect(state.upNext).toEqual([3]);
  });

  it('ignores a match that is not ready yet at the step asked for', () => {
    const matches = [match(1, 1, 1, [1, 2]), match(2, 2, 1, [1, 3], { readyStep: 5 })];
    const state = buildQueue({ stations: 2, createdAt: T0, matches, results: [] });
    expect(slots(state)).toEqual([[1, 1, T0], [2, null, null]]);
    expect(state.upNext).toEqual([]);
  });
});

describe('buildQueue: the bye hold-back', () => {
  // 5 players in 8 slots: only 4 v 5 is played in round 1. Seeds 1, 2, and 3 have byes, so
  // their round 2 matches wait until round 1 is done and a late player could still take a bye.
  const matches = [
    match(10, 1, 4, [4, 5], { firstRound: true }),
    match(20, 2, 2, [2, 3], { hasByePlayer: true }),
    match(21, 2, 1, [1, 4], { readyStep: 1, hasByePlayer: true }),
  ];

  it('keeps the second station idle while a first-round match is unplayed', () => {
    const state = buildQueue({ stations: 2, createdAt: T0, matches, results: [] });
    expect(slots(state)).toEqual([[1, 10, T0], [2, null, null]]);
    expect(state.upNext).toEqual([]);
  });

  it('releases the held matches when round 1 is done, oldest ready first', () => {
    const state = buildQueue({ stations: 2, createdAt: T0, matches, results: [{ matchId: 10, at: T1 }] });
    expect(slots(state)).toEqual([[1, 20, T1], [2, 21, T1]]);
  });

  it('does not hold anything back when no one is marked as having had a bye', () => {
    const free = matches.map((m) => ({ ...m, hasByePlayer: false }));
    const state = buildQueue({ stations: 2, createdAt: T0, matches: free, results: [] });
    expect(slots(state)).toEqual([[1, 10, T0], [2, 20, T0]]);
  });
});

describe('buildQueue: one player on one station', () => {
  // A round robin of 4: every match is ready at creation.
  const matches = [
    match(1, 1, 1, [1, 2]),
    match(2, 1, 2, [3, 4]),
    match(3, 2, 1, [1, 3]),
    match(4, 2, 2, [2, 4]),
    match(5, 3, 1, [1, 4]),
    match(6, 3, 2, [2, 3]),
  ];

  it('skips a match whose player is still on another station', () => {
    const state = buildQueue({ stations: 2, createdAt: T0, matches, results: [{ matchId: 1, at: T1 }] });
    // Every waiting match has 3 or 4 in it, and both are playing, so the freed station waits.
    expect(slots(state)).toEqual([[1, null, null], [2, 2, T0]]);
    expect(state.upNext).toEqual([3, 4, 5, 6]);
  });

  it('calls the idle station at the time of the result that made a match possible', () => {
    const results = [{ matchId: 1, at: T1 }, { matchId: 2, at: T2 }];
    const state = buildQueue({ stations: 2, createdAt: T0, matches, results });
    expect(slots(state)).toEqual([[1, 3, T2], [2, 4, T2]]);
    expect(state.upNext).toEqual([5, 6]);
  });
});

describe('buildQueue: results that do not fit', () => {
  const matches = [match(1, 1, 1, [1, 2]), match(2, 1, 2, [3, 4]), match(3, 1, 3, [5, 6])];

  it('lists a result recorded for a match that was not on a station', () => {
    // One station holds match 1, yet a result for match 2 arrives.
    const state = buildQueue({ stations: 1, createdAt: T0, matches, results: [{ matchId: 2, at: T1 }] });
    expect(state.offStation).toEqual([2]);
    expect(slots(state)).toEqual([[1, 1, T0]]);
    expect(state.upNext).toEqual([3]);
  });
});

describe('buildQueue: an older undo', () => {
  // An older undo is a log entry with no result. The match it reopens has a second entry,
  // ready from the step after the undo, and marked reopened.
  const UNDO = { matchId: null, at: T2 };

  it('keeps every station and puts the reopened match at the front of Up next', () => {
    const matches = [
      match(1, 1, 1, [1, 2]),
      match(2, 1, 2, [3, 4]),
      match(3, 1, 3, [5, 6]),
      match(1, 1, 1, [1, 2], { readyStep: 2, reopened: true }),
    ];
    const state = buildQueue({ stations: 1, createdAt: T0, matches, results: [{ matchId: 1, at: T1 }, UNDO] });
    expect(slots(state)).toEqual([[1, 2, T1]]);
    expect(state.upNext).toEqual([1, 3]);
    // The station frees and takes the reopened match ahead of match 3.
    const next = buildQueue({ stations: 1, createdAt: T0, matches, results: [{ matchId: 1, at: T1 }, UNDO, { matchId: 2, at: T3 }] });
    expect(slots(next)).toEqual([[1, 1, T3]]);
    expect(next.upNext).toEqual([3]);
  });

  it('calls the reopened match to an idle station at the time of the undo', () => {
    const matches = [match(1, 1, 1, [1, 2]), match(2, 1, 2, [3, 4]), match(1, 1, 1, [1, 2], { readyStep: 2, reopened: true })];
    const state = buildQueue({ stations: 2, createdAt: T0, matches, results: [{ matchId: 1, at: T1 }, UNDO] });
    expect(slots(state)).toEqual([[1, 1, T2], [2, 2, T0]]);
    expect(state.offStation).toEqual([]);
  });

  it('drops a match that stopped being ready from Up next and from its station', () => {
    // Match 3 was ready from step 1 until the undo at step 2 took one of its players away.
    const matches = [match(1, 1, 1, [1, 2]), match(2, 1, 2, [3, 4]), match(3, 2, 1, [1, 5], { readyStep: 1, until: 3 })];
    const waiting = buildQueue({ stations: 1, createdAt: T0, matches, results: [{ matchId: 1, at: T1 }, { matchId: 2, at: T2 }] });
    expect(slots(waiting)).toEqual([[1, 3, T2]]);
    const dropped = buildQueue({ stations: 1, createdAt: T0, matches, results: [{ matchId: 1, at: T1 }, { matchId: 2, at: T2 }, { matchId: null, at: T3 }] });
    expect(slots(dropped)).toEqual([[1, null, null]]);
    expect(dropped.upNext).toEqual([]);
  });

  it('does not hold back a bye player for a reopened first-round match', () => {
    const matches = [
      match(10, 1, 4, [4, 5], { firstRound: true }),
      match(20, 2, 2, [2, 3], { hasByePlayer: true }),
      match(10, 1, 4, [4, 5], { firstRound: true, readyStep: 3, reopened: true }),
      match(30, 2, 1, [1, 6], { readyStep: 1, hasByePlayer: true }),
      match(40, 2, 3, [7, 8], { readyStep: 2, hasByePlayer: true }),
    ];
    // Round 1 was finished at step 1; match 20 was called then and its result made step 2.
    const log = [{ matchId: 10, at: T1 }, { matchId: 20, at: T2 }, { matchId: null, at: T3 }];
    const state = buildQueue({ stations: 1, createdAt: T0, matches, results: log });
    // Match 40 waits on with the reopened match ahead of it, not held back.
    expect(slots(state)).toEqual([[1, 30, T2]]);
    expect(state.upNext).toEqual([10, 40]);
  });
});

describe('buildQueue: the station count', () => {
  it.each([0, 9, 1.5, Number.NaN])('turns down %s stations', (stations) => {
    expect(() => buildQueue({ stations, createdAt: T0, matches: [], results: [] })).toThrow(RangeError);
  });

  it('numbers eight stations from 1', () => {
    const state = buildQueue({ stations: 8, createdAt: T0, matches: [], results: [] });
    expect(state.stations.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('buildQueue: heats of up to 4 players', () => {
  const heat = (id: number, number: number, players: number[], extra: Partial<QueueMatch> = {}): QueueMatch => ({
    id,
    round: 1,
    number,
    players,
    readyStep: 0,
    firstRound: false,
    hasByePlayer: false,
    ...extra,
  });

  it('calls each heat to its own station', () => {
    const matches = [heat(101, 1, [1, 2, 3, 4]), heat(102, 2, [5, 6, 7])];
    const state = buildQueue({ stations: 2, createdAt: T0, matches, results: [] });
    expect(slots(state)).toEqual([[1, 101, T0], [2, 102, T0]]);
  });

  it('skips a heat while any of its players is on another station', () => {
    // A tie-break heat holding player 3 is ready while 3's heat is still being played.
    const matches = [heat(101, 1, [1, 2, 3, 4]), heat(1000, 1, [3, 5]), heat(102, 2, [6, 7, 8])];
    const state = buildQueue({ stations: 2, createdAt: T0, matches, results: [] });
    expect(slots(state)).toEqual([[1, 101, T0], [2, 102, T0]]);
    expect(state.upNext).toEqual([1000]);
  });
});

describe('buildQueue: a match made after the result that opened its step (readyAt)', () => {
  // A tie-break is made when the host presses Play tie-break, which is after the last result.
  const tie = (id: number, readyStep: number, extra: Partial<QueueMatch> = {}): QueueMatch =>
    match(id, 1, id, [1, 2], { readyStep, ...extra });

  it('is called at its own time when that is later than the result of its step', () => {
    const matches = [match(1, 1, 1, [1, 2], { firstRound: true }), tie(1000, 1, { readyAt: T3 })];
    const state = buildQueue({ stations: 1, createdAt: T0, matches, results: [{ matchId: 1, at: T1 }] });
    expect(slots(state)).toEqual([[1, 1000, T3]]);
  });

  it('is called at the later result when the station only came free after it was made', () => {
    const matches = [tie(1000, 0, { readyAt: T1 }), tie(1001, 0, { readyAt: T1 })];
    // 1000 fills the station at creation (before its own time, so the later time wins), and 1001 waits for the result.
    const state = buildQueue({ stations: 1, createdAt: T0, matches, results: [{ matchId: 1000, at: T2 }] });
    expect(slots(state)).toEqual([[1, 1001, T2]]);
  });

  it('is called at the time of its step when it has no time of its own', () => {
    const matches = [match(1, 1, 1, [1, 2], { firstRound: true }), tie(1000, 1)];
    const state = buildQueue({ stations: 1, createdAt: T0, matches, results: [{ matchId: 1, at: T1 }] });
    expect(slots(state)).toEqual([[1, 1000, T1]]);
  });

  it('is not used by a reopened entry, which is called at the time of its step', () => {
    const matches = [tie(1000, 0, { readyAt: T1 }), tie(1000, 2, { reopened: true })];
    const results = [{ matchId: 1000, at: T2 }, { matchId: null, at: T3 }];
    const state = buildQueue({ stations: 1, createdAt: T0, matches, results });
    expect(slots(state)).toEqual([[1, 1000, T3]]);
  });
});
