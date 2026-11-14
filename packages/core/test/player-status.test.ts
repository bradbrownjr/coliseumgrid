// Where a player stands in a bracket or in groups (src/player-status.ts). The answers are
// written out by hand the way the server builds them: a match or group on a station, Up next in
// queue order, and the rest of the matches.

import { describe, expect, it } from 'vitest';
import {
  alertLevel,
  newAlert,
  notInStatus,
  playerStatus,
  type Bracket,
  type BracketMatch,
  type FollowStatus,
  type Heat,
  type HeatKind,
  type Heats,
  type MatchSide,
  type MatchStatus,
  type Player,
  type PlayerStatus,
} from '../src/index.ts';

const p = (id: number): Player => ({ id, handle: `P${id}` });

/** A match. A number is a known player, null an unknown one, 'bye' an empty slot. */
function match(id: number, status: MatchStatus, a: number | null | 'bye', b: number | null | 'bye', side: MatchSide = 'main', round = 1): BracketMatch {
  const slot = (v: number | null | 'bye') => ({ player: typeof v === 'number' ? p(v) : null, bye: v === 'bye' });
  return { id, side, round, number: id, status, slots: [slot(a), slot(b)], winner: null, resultId: null };
}

interface BracketPieces {
  matches: BracketMatch[];
  /** Match ids on stations 1, 2, and so on; null for an idle station. */
  stations: (number | null)[];
  upNext?: number[];
  finished?: boolean;
  places?: [number, number][];
  ties?: { place: number; players: number[] }[];
}

function bracket({ matches, stations, upNext = [], finished = false, places = [], ties = [] }: BracketPieces): Bracket {
  const byId = (id: number): BracketMatch => matches.find((m) => m.id === id) as BracketMatch;
  return {
    id: 1,
    format: 'single',
    bestOf: 1,
    finished,
    lateOpen: false,
    lastResultId: null,
    stations: stations.map((id, i) => ({ number: i + 1, match: id === null ? null : byId(id), calledAt: null })),
    upNext: upNext.map(byId),
    matches,
    standings: places.map(([id, place]) => ({ place, player: p(id), wins: 0, losses: 0 })),
    ties: ties.map((t) => ({ place: t.place, players: t.players.map(p), started: false })),
  };
}

function heat(id: number, status: Heat['status'], players: number[], kind: HeatKind = 'round', round = 1): Heat {
  return { id, kind, round, number: id % 100, status, players: players.map(p), order: null, resultId: null };
}

interface HeatsPieces {
  heats: Heat[];
  stations: (number | null)[];
  upNext?: number[];
  round?: number | null;
  finished?: boolean;
  finalSize?: number;
  places?: [number, number][];
  ties?: { place: number; players: number[] }[];
}

function groups({ heats, stations, upNext = [], round = 1, finished = false, finalSize = 4, places = [], ties = [] }: HeatsPieces): Heats {
  const byId = (id: number): Heat => heats.find((h) => h.id === id) as Heat;
  return {
    id: 1,
    races: 1,
    rounds: 2,
    points: [4, 3, 2, 1],
    finished,
    lateOpen: false,
    lastResultId: null,
    round,
    stations: stations.map((id, i) => ({ number: i + 1, heat: id === null ? null : byId(id), calledAt: null })),
    upNext: upNext.map(byId),
    heats,
    standings: places.map(([id, place]) => ({ place, player: p(id), points: 0, heatsPlayed: 0 })),
    finalSize,
    ties: ties.map((t) => ({ place: t.place, players: t.players.map(p), started: false })),
  };
}

const summary = (s: PlayerStatus) => [s.status, s.away, s.station, s.matchId];

describe('playerStatus: nothing running', () => {
  it('is not-in for every player when there is no bracket or groups', () => {
    expect(playerStatus(null, 1)).toEqual(notInStatus());
    expect(notInStatus()).toEqual({ status: 'not-in', away: null, station: null, matchId: null, others: [], place: null });
  });

  it('gives a new object each time, so a caller can change it', () => {
    expect(notInStatus().others).not.toBe(notInStatus().others);
  });
});

describe('playerStatus: bracket on one station, 8 players', () => {
  const answer = bracket({
    matches: [
      match(1, 'playing', 1, 2),
      match(2, 'ready', 3, 4),
      match(3, 'ready', 5, 6),
      match(4, 'ready', 7, 8),
      match(5, 'waiting', null, null, 'main', 2),
    ],
    stations: [1],
    upNext: [2, 3, 4],
  });

  it('is now on the station, with the other player', () => {
    for (const [id, other] of [[1, 2], [2, 1]] as const) {
      const status = playerStatus(answer, id);
      expect(summary(status)).toEqual(['now', 0, 1, 1]);
      expect(status.others).toEqual([p(other)]);
      expect(status.place).toBeNull();
    }
  });

  it.each([
    [3, 'next', 1, 2],
    [4, 'next', 1, 2],
    [5, 'two-away', 2, 3],
    [6, 'two-away', 2, 3],
    [7, 'later', 3, 4],
    [8, 'later', 3, 4],
  ] as [number, FollowStatus, number, number][])('puts player %i at %s, away %i, in match %i', (id, status, away, matchId) => {
    expect(summary(playerStatus(answer, id))).toEqual([status, away, null, matchId]);
  });

  it('names the other player of a queued match', () => {
    expect(playerStatus(answer, 5).others).toEqual([p(6)]);
  });

  it('is not-in for a player the bracket doesn\'t have', () => {
    expect(playerStatus(answer, 99)).toEqual(notInStatus());
  });
});

describe('playerStatus: two stations', () => {
  const answer = bracket({
    matches: [match(1, 'playing', 1, 2), match(2, 'playing', 3, 4), match(3, 'ready', 5, 6), match(4, 'ready', 1, 5)],
    stations: [1, 2],
    upNext: [3, 4],
  });

  it('reports the station number of each', () => {
    expect(summary(playerStatus(answer, 1))).toEqual(['now', 0, 1, 1]);
    expect(summary(playerStatus(answer, 4))).toEqual(['now', 0, 2, 2]);
  });

  it('counts a player by the first entry that holds them, not by a later one', () => {
    // Player 5 is in entries 1 and 2 of Up next; the first counts.
    expect(summary(playerStatus(answer, 5))).toEqual(['next', 1, null, 3]);
  });

  it('puts a player on a station ahead of any place in Up next', () => {
    // Player 1 is also in Up next entry 2, and is on station 1.
    expect(playerStatus(answer, 1).status).toBe('now');
  });

  it('ignores an idle station', () => {
    const idle = bracket({ matches: [match(1, 'ready', 1, 2)], stations: [null, null], upNext: [1] });
    expect(summary(playerStatus(idle, 1))).toEqual(['next', 1, null, 1]);
  });
});

describe('playerStatus: a player with a bye', () => {
  // 3 players, one bye: player 1 moved on, players 2 and 3 play, then the final.
  const early = bracket({
    matches: [match(1, 'bye', 1, 'bye'), match(2, 'playing', 2, 3), match(3, 'waiting', 1, null, 'main', 2)],
    stations: [2],
  });

  it('waits in the next round, with nobody to name yet', () => {
    const status = playerStatus(early, 1);
    expect(summary(status)).toEqual(['waiting', null, null, 3]);
    expect(status.others).toEqual([]);
  });

  it('is up when the final is called', () => {
    const final = bracket({
      matches: [match(1, 'bye', 1, 'bye'), match(2, 'done', 2, 3), match(3, 'playing', 1, 2, 'main', 2)],
      stations: [3],
    });
    expect(summary(playerStatus(final, 1))).toEqual(['now', 0, 1, 3]);
    expect(playerStatus(final, 1).others).toEqual([p(2)]);
  });

  it('is waiting while held back for a first-round bye, not in Up next', () => {
    // 5 players: player 5 had the bye. Its second-round match is ready but held back until
    // round 1 is done, so it is not in Up next.
    const held = bracket({
      matches: [match(1, 'playing', 1, 2), match(2, 'ready', 3, 4), match(3, 'bye', 5, 'bye'), match(4, 'ready', 5, 1, 'main', 2)],
      stations: [1],
      upNext: [2],
    });
    const status = playerStatus(held, 5);
    expect(summary(status)).toEqual(['waiting', null, null, 4]);
    expect(status.others).toEqual([p(1)]);
    expect(summary(playerStatus(held, 3))).toEqual(['next', 1, null, 2]);
  });
});

describe('playerStatus: a player out of the bracket', () => {
  it('is out with no match left, while the others play', () => {
    // 3 players: player 3 lost the semi-final to player 2 and has no 3rd-place match.
    const answer = bracket({
      matches: [match(1, 'bye', 1, 'bye'), match(2, 'done', 2, 3), match(3, 'playing', 1, 2, 'main', 2)],
      stations: [3],
      places: [[2, 2]],
    });
    const status = playerStatus(answer, 3);
    expect(status).toEqual({ status: 'out', away: null, station: null, matchId: null, others: [], place: null });
  });

  it('is waiting while the 3rd-place match is still to be made', () => {
    const answer = bracket({
      matches: [
        match(1, 'done', 1, 2),
        match(2, 'playing', 3, 4),
        match(3, 'waiting', 1, null, 'final', 2),
        match(4, 'waiting', 2, null, 'third', 2),
      ],
      stations: [2],
    });
    expect(summary(playerStatus(answer, 2))).toEqual(['waiting', null, null, 4]);
  });

  it('is out in a round robin once every match is played', () => {
    const answer = bracket({
      matches: [match(1, 'done', 1, 2), match(2, 'done', 1, 3), match(3, 'playing', 2, 3)],
      stations: [3],
    });
    expect(playerStatus(answer, 1).status).toBe('out');
    expect(playerStatus(answer, 2).status).toBe('now');
  });

  it('is waiting while tied for a place that has to be played off', () => {
    const answer = bracket({
      matches: [match(1, 'done', 1, 2), match(2, 'done', 2, 3), match(3, 'done', 3, 1)],
      stations: [null],
      ties: [{ place: 1, players: [1, 2, 3] }],
    });
    for (const id of [1, 2, 3]) expect(summary(playerStatus(answer, id))).toEqual(['waiting', null, null, null]);
  });

  it('is next once the tie-break match is made', () => {
    const answer = bracket({
      matches: [match(1, 'done', 1, 2), match(2, 'done', 2, 3), match(3, 'done', 3, 1), match(4, 'ready', 1, 2, 'tie-break')],
      stations: [null],
      upNext: [4],
      ties: [{ place: 1, players: [1, 2, 3] }],
    });
    expect(summary(playerStatus(answer, 1))).toEqual(['next', 1, null, 4]);
    expect(summary(playerStatus(answer, 3))).toEqual(['waiting', null, null, null]);
  });
});

describe('playerStatus: a finished bracket', () => {
  const answer = bracket({
    matches: [match(1, 'done', 1, 2), match(2, 'done', 3, 4), match(3, 'done', 1, 3, 'main', 2), match(4, 'done', 2, 4, 'third', 2)],
    stations: [null],
    finished: true,
    places: [[1, 1], [3, 2], [2, 3], [4, 4]],
  });

  it('is done with the final place', () => {
    expect(playerStatus(answer, 1)).toEqual({ status: 'done', away: null, station: null, matchId: null, others: [], place: 1 });
    expect(playerStatus(answer, 4).place).toBe(4);
  });

  it('is not-in for a player who wasn\'t in it', () => {
    expect(playerStatus(answer, 9).status).toBe('not-in');
  });
});

describe('playerStatus: a late player', () => {
  // Player 4 joined and took player 1's empty slot.
  const before = bracket({ matches: [match(1, 'bye', 1, 'bye'), match(2, 'playing', 2, 3), match(3, 'waiting', 1, null, 'main', 2)], stations: [2] });
  const after = bracket({ matches: [match(1, 'ready', 1, 4), match(2, 'playing', 2, 3), match(3, 'waiting', null, null, 'main', 2)], stations: [2], upNext: [1] });

  it('is not-in before joining, then next, behind what was already waiting', () => {
    expect(playerStatus(before, 4).status).toBe('not-in');
    expect(summary(playerStatus(after, 4))).toEqual(['next', 1, null, 1]);
    expect(playerStatus(after, 4).others).toEqual([p(1)]);
  });

  it('is later behind other waiting matches', () => {
    const queued = bracket({
      matches: [match(1, 'playing', 5, 6), match(2, 'ready', 7, 8), match(3, 'ready', 9, 4)],
      stations: [1],
      upNext: [2, 3],
    });
    expect(summary(playerStatus(queued, 4))).toEqual(['two-away', 2, null, 3]);
  });
});

describe('playerStatus: groups', () => {
  // 6 players, 2 rounds, one station: group 101 is 1, 2, 3 and group 102 is 4, 5, 6.
  const opening = groups({
    heats: [heat(101, 'playing', [1, 2, 3]), heat(102, 'ready', [4, 5, 6])],
    stations: [101],
    upNext: [102],
    places: [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]],
  });

  it('is now in the group on the station, with the others', () => {
    const status = playerStatus(opening, 2);
    expect(summary(status)).toEqual(['now', 0, 1, 101]);
    expect(status.others).toEqual([p(1), p(3)]);
  });

  it('is next in the first group of Up next', () => {
    const status = playerStatus(opening, 5);
    expect(summary(status)).toEqual(['next', 1, null, 102]);
    expect(status.others).toEqual([p(4), p(6)]);
  });

  it('is two away and later by group', () => {
    const many = groups({
      heats: [heat(101, 'playing', [1, 2, 3, 4]), heat(102, 'ready', [5, 6, 7, 8]), heat(103, 'ready', [9, 10, 11, 12]), heat(104, 'ready', [13, 14, 15, 16])],
      stations: [101],
      upNext: [102, 103, 104],
    });
    expect(playerStatus(many, 5).status).toBe('next');
    expect(summary(playerStatus(many, 10))).toEqual(['two-away', 2, null, 103]);
    expect(summary(playerStatus(many, 16))).toEqual(['later', 3, null, 104]);
  });

  it('is waiting between rounds, when the next round is not made', () => {
    const between = groups({
      heats: [heat(101, 'done', [1, 2, 3]), heat(102, 'playing', [4, 5, 6])],
      stations: [102],
      places: [[1, 1], [2, 2], [3, 3], [4, 4], [5, 4], [6, 4]],
    });
    expect(playerStatus(between, 1)).toEqual({ status: 'waiting', away: null, station: null, matchId: null, others: [], place: null });
    expect(playerStatus(between, 4).status).toBe('now');
  });

  it('is not-in for a player who isn\'t in the groups, and next after a late join', () => {
    expect(playerStatus(opening, 7).status).toBe('not-in');
    const joined = groups({
      heats: [heat(101, 'playing', [1, 2, 3]), heat(102, 'ready', [4, 5, 6, 7])],
      stations: [101],
      upNext: [102],
      places: [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1]],
    });
    expect(summary(playerStatus(joined, 7))).toEqual(['next', 1, null, 102]);
  });

  it('plays only the final with 2 to 4 players', () => {
    const only = groups({
      heats: [heat(2000, 'playing', [1, 2, 3], 'final')],
      stations: [2000],
      round: null,
      finalSize: 3,
      places: [[1, 1], [2, 1], [3, 1]],
    });
    expect(summary(playerStatus(only, 3))).toEqual(['now', 0, 1, 2000]);
  });

  const qualified = [heat(101, 'done', [1, 2, 3]), heat(102, 'done', [4, 5, 6])];

  it('is out below the cut once the final is made, and now in it', () => {
    const final = groups({
      heats: [...qualified, heat(2000, 'playing', [1, 2, 3, 4], 'final')],
      stations: [2000],
      round: null,
      places: [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]],
    });
    expect(summary(playerStatus(final, 4))).toEqual(['now', 0, 1, 2000]);
    expect(playerStatus(final, 5).status).toBe('out');
    expect(playerStatus(final, 6).place).toBeNull();
  });

  it('is waiting for the final, or for a tie-break at the cut, until it is made', () => {
    const tied = groups({
      heats: [...qualified, heat(1000, 'ready', [4, 5], 'tie-break', 1)],
      stations: [null],
      upNext: [1000],
      round: null,
      places: [[1, 1], [2, 2], [3, 3], [4, 4], [5, 4], [6, 6]],
      ties: [{ place: 4, players: [4, 5] }],
    });
    expect(summary(playerStatus(tied, 4))).toEqual(['next', 1, null, 1000]);
    expect(playerStatus(tied, 1).status).toBe('waiting');
    expect(playerStatus(tied, 6).status).toBe('out');

    const unmade = groups({
      heats: qualified,
      stations: [null],
      round: null,
      places: [[1, 1], [2, 2], [3, 3], [4, 4], [5, 4], [6, 6]],
      ties: [{ place: 4, players: [4, 5] }],
    });
    expect(summary(playerStatus(unmade, 5))).toEqual(['waiting', null, null, null]);
  });

  it('is done with a place when the final is over, even below the cut', () => {
    const over = groups({
      heats: [...qualified, heat(2000, 'done', [1, 2, 3, 4], 'final')],
      stations: [null],
      round: null,
      finished: true,
      places: [[2, 1], [1, 2], [3, 3], [4, 4], [5, 5], [6, 6]],
    });
    expect(playerStatus(over, 2)).toEqual({ status: 'done', away: null, station: null, matchId: null, others: [], place: 1 });
    expect(playerStatus(over, 6).place).toBe(6);
    expect(playerStatus(over, 7).status).toBe('not-in');
  });
});

describe('alertLevel', () => {
  it.each([
    ['now', 'called'],
    ['next', 'next'],
    ['two-away', 'two-away'],
    ['later', 'none'],
    ['waiting', 'none'],
    ['out', 'none'],
    ['done', 'none'],
    ['not-in', 'none'],
  ] as const)('is %s for %s', (status, level) => {
    expect(alertLevel({ status })).toBe(level);
  });
});

describe('newAlert', () => {
  const at = (status: FollowStatus, matchId: number | null = null) => ({ status, matchId });

  it('says called when the player is put on a station', () => {
    expect(newAlert(at('next', 5), at('now', 5))).toBe('called');
    expect(newAlert(at('later', 5), at('now', 5))).toBe('called');
    expect(newAlert(at('waiting'), at('now', 5))).toBe('called');
  });

  it('says called again for a different match on a station, and not for the same one', () => {
    expect(newAlert(at('now', 5), at('now', 9))).toBe('called');
    expect(newAlert(at('now', 5), at('now', 5))).toBeNull();
  });

  it('says next when the player becomes first in Up next, once', () => {
    expect(newAlert(at('two-away', 5), at('next', 5))).toBe('next');
    expect(newAlert(at('now', 4), at('next', 5))).toBe('next');
    expect(newAlert(at('next', 5), at('next', 5))).toBeNull();
    expect(newAlert(at('next', 5), at('next', 6))).toBeNull();
  });

  it('says nothing for the quieter statuses, and nothing when there is nothing to compare', () => {
    expect(newAlert(at('later', 5), at('two-away', 5))).toBeNull();
    expect(newAlert(at('now', 5), at('done'))).toBeNull();
    expect(newAlert(at('now', 5), at('waiting'))).toBeNull();
    expect(newAlert(null, at('now', 5))).toBeNull();
    expect(newAlert(null, at('next', 5))).toBeNull();
  });

  it('takes a whole player status too', () => {
    const next = playerStatus(bracket({ matches: [match(1, 'playing', 1, 2), match(2, 'ready', 3, 4)], stations: [1], upNext: [2] }), 3);
    const before = playerStatus(bracket({ matches: [match(1, 'playing', 1, 2), match(2, 'ready', 3, 4)], stations: [1], upNext: [] }), 3);
    expect(newAlert(before, next)).toBe('next');
  });
});
