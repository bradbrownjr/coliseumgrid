import { DEFAULT_POINTS, isPointsTable, type Heat, type Heats, type Player } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { stationWords } from '../src/pages/host/bracketWords.ts';
import {
  doneHeats,
  groupSizesWords,
  groupsProblem,
  groupsSummary,
  heatTitle,
  orderEntry,
  orderQuestion,
  orderWords,
  parsePoints,
  phaseWords,
  playersInHeats,
  pointsProblem,
  gameCount,
  gamesWords,
  heatOnStation,
  recordHelp,
  roundsWords,
  savedWords,
  showStandings,
} from '../src/pages/host/groupWords.ts';

const zap: Player = { id: 1, handle: 'Zap' };
const kai: Player = { id: 2, handle: 'Kai' };
const blaze: Player = { id: 3, handle: 'Blaze' };
const moe: Player = { id: 4, handle: 'Moe' };

function heat(id: number, over: Partial<Heat> = {}): Heat {
  return { id, kind: 'round', round: 1, number: id, status: 'ready', players: [zap, kai, blaze, moe], order: null, resultId: null, ...over };
}

function heats(over: Partial<Heats> = {}): Heats {
  return {
    id: 1,
    races: 1,
    rounds: 2,
    points: [4, 3, 2, 1],
    finished: false,
    lateOpen: true,
    lastResultId: null,
    round: 1,
    stations: [],
    upNext: [],
    heats: [],
    standings: [],
    finalSize: 4,
    ties: [],
    ...over,
  };
}

describe('heatTitle', () => {
  it('names a qualifying group by round and number', () => {
    expect(heatTitle(heat(3, { round: 2, number: 3 }))).toBe('Round 2, group 3');
  });
  it('calls the final "Final"', () => {
    expect(heatTitle(heat(2000, { kind: 'final', round: 1, number: 1 }))).toBe('Final');
  });
  it('calls a lone tie-break "Tie-break group" and numbers them when a pass has several', () => {
    const one = heat(1000, { kind: 'tie-break', round: 1, number: 1 });
    expect(heatTitle(one, [one])).toBe('Tie-break group');
    const two = heat(1001, { kind: 'tie-break', round: 1, number: 2 });
    expect(heatTitle(one, [one, two])).toBe('Tie-break group 1');
    expect(heatTitle(two, [one, two])).toBe('Tie-break group 2');
  });
  it('says which try a later tie-break pass is', () => {
    const again = heat(1100, { kind: 'tie-break', round: 2, number: 1 });
    expect(heatTitle(again, [again])).toBe('Tie-break group, try 2');
  });
  it('words the snackbar after a save', () => {
    expect(savedWords(heat(1), [])).toBe('Saved: Round 1, group 1');
  });
});

describe('orderEntry', () => {
  const four = [zap, kai, blaze, moe];
  it('starts with nobody picked and everyone left', () => {
    const entry = orderEntry(four, []);
    expect(entry.picked).toEqual([]);
    expect(entry.remaining).toEqual(four);
    expect(entry.complete).toBeNull();
    expect(orderQuestion(entry)).toBe('Who came 1st?');
  });
  it('asks for each place in turn', () => {
    expect(orderQuestion(orderEntry(four, [3]))).toBe('Who came 2nd?');
    expect(orderQuestion(orderEntry(four, [3, 1]))).toBe('Who came 3rd?');
  });
  it('fills in the last player once one is left', () => {
    const entry = orderEntry(four, [3, 1, 4]);
    expect(entry.complete?.map((p) => p.id)).toEqual([3, 1, 4, 2]);
    expect(entry.remaining).toEqual([]);
    expect(orderQuestion(entry)).toBe('Is this the order?');
  });
  it('fills in the last of 2 and of 3 players', () => {
    expect(orderEntry([zap, kai], [2]).complete?.map((p) => p.id)).toEqual([2, 1]);
    expect(orderEntry([zap, kai, blaze], [1, 3]).complete?.map((p) => p.id)).toEqual([1, 3, 2]);
  });
  it('is not complete before the second to last tap', () => {
    expect(orderEntry([zap, kai, blaze], [1]).complete).toBeNull();
  });
  it('ignores a repeated or unknown id', () => {
    const entry = orderEntry(four, [3, 3, 99, 1]);
    expect(entry.picked.map((p) => p.id)).toEqual([3, 1]);
    expect(entry.remaining.map((p) => p.id)).toEqual([2, 4]);
  });
  it('gives an order the server accepts: every player once', () => {
    const order = orderEntry(four, [4, 2, 1]).complete ?? [];
    expect(order.map((p) => p.id).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('points table checks', () => {
  it('accepts the default', () => {
    expect(pointsProblem(DEFAULT_POINTS.map(String))).toBeNull();
  });
  it('accepts equal points and zeros after 1st', () => {
    expect(pointsProblem(['5', '5', '0', '0'])).toBeNull();
  });
  it('accepts exactly the tables isPointsTable accepts', () => {
    const values = ['0', '1', '3', '20', '21'];
    for (const a of values) for (const b of values) for (const c of values) for (const d of values) {
      const typed = [a, b, c, d];
      expect(pointsProblem(typed) === null, typed.join(',')).toBe(isPointsTable(typed.map(Number)));
    }
  });
  it('asks for whole numbers 0 to 20 when a box is blank, a fraction, negative, or too big', () => {
    for (const typed of [['', '3', '2', '1'], ['4', '2.5', '2', '1'], ['4', '-1', '0', '0'], ['21', '3', '2', '1'], ['4', 'a', '2', '1']]) {
      expect(pointsProblem(typed)).toBe('Use whole numbers from 0 to 20.');
    }
  });
  it('says 1st needs a point', () => {
    expect(pointsProblem(['0', '0', '0', '0'])).toBe('1st place needs at least 1 point.');
  });
  it('says which place scores more than the one before', () => {
    expect(pointsProblem(['4', '3', '5', '1'])).toBe("3rd can't score more than 2nd.");
  });
  it('parses typed numbers with spaces, and nothing else', () => {
    expect(parsePoints([' 4', '3 ', '2', '1'])).toEqual([4, 3, 2, 1]);
    expect(parsePoints(['4', '3', '2'])).toBeNull();
    expect(parsePoints(['4', '3', '2', 'x'])).toBeNull();
  });
});

describe('start words', () => {
  it('needs 2 to 32 players', () => {
    expect(groupsProblem(1)).toBe('Pick at least 2 players.');
    expect(groupsProblem(2)).toBeNull();
    expect(groupsProblem(32)).toBeNull();
    expect(groupsProblem(33)).toBe('Pick 32 players at most.');
  });
  it('says how round 1 splits', () => {
    expect(groupSizesWords(10)).toBe('3 groups in round 1: 4, 3, and 3 players.');
    expect(groupSizesWords(5)).toBe('2 groups in round 1: 3 and 2 players.');
    expect(groupSizesWords(32)).toBe('8 groups in round 1: 4, 4, 4, 4, 4, 4, 4, and 4 players.');
  });
  it('says one group plays the final for 2 to 4 players, and nothing for a bad count', () => {
    for (const count of [2, 3, 4]) expect(groupSizesWords(count)).toBe('One group plays the final.');
    expect(groupSizesWords(1)).toBeNull();
    expect(groupSizesWords(33)).toBeNull();
  });
  it('says there are no rounds for 2 to 4 players', () => {
    expect(roundsWords(2, 4)).toBe('With 2 to 4 players there are no rounds, only the final.');
    expect(roundsWords(2, 5)).toBe('Everyone plays 2 rounds of groups. Then the top 4 play the final.');
    expect(roundsWords(1, 5)).toBe('Everyone plays 1 round of groups. Then the top 4 play the final.');
  });
  it('says what games per group means: a race or a match, never only a race', () => {
    expect(gamesWords(1)).toBe('Each group plays 1 game, a race or a match. Record the order they finish.');
    expect(gamesWords(3)).toBe('Each group plays 3 games, each a race or a match. Record the order after all of them.');
    expect(recordHelp(1)).toBe('Tap the players in the order they finished.');
    expect(recordHelp(4)).toBe('Tap the players in their order after all 4 games.');
  });
});

describe('heatOnStation', () => {
  const station = (number: number, held: Heat | null) => ({ number, heat: held, calledAt: held ? '2027-07-10T14:00:00.000Z' : null });
  it('is true for a heat on any station', () => {
    const answer = heats({ stations: [station(1, heat(101)), station(2, heat(102))] });
    expect(heatOnStation(answer, 101)).toBe(true);
    expect(heatOnStation(answer, 102)).toBe(true);
  });
  it('is false for a heat that left, was never called, or is in Up next', () => {
    const answer = heats({ stations: [station(1, heat(101)), station(2, null)], upNext: [heat(103)] });
    expect(heatOnStation(answer, 102)).toBe(false);
    expect(heatOnStation(answer, 103)).toBe(false);
  });
  it('is false when there are no stations', () => {
    expect(heatOnStation(heats(), 101)).toBe(false);
  });
});

describe('showStandings', () => {
  const row = (heatsPlayed: number) => ({ place: 1, player: zap, points: 0, heatsPlayed });
  it('hides them before the final when 2 to 4 players have no points', () => {
    expect(showStandings(heats({ rounds: 0, standings: [] }))).toBe(false);
  });
  it('shows the places once the final is done', () => {
    expect(showStandings(heats({ rounds: 0, finished: true, standings: [row(0), row(0), row(0)] }))).toBe(true);
  });
});

describe('words for what is running', () => {
  it('words an order', () => {
    expect(orderWords([zap, kai, blaze])).toBe('1st Zap, 2nd Kai, 3rd Blaze');
  });
  it('counts stations and games', () => {
    expect(stationWords(1)).toBe('1 station');
    expect(stationWords(2)).toBe('2 stations');
    expect(gameCount(1)).toBe('1 game');
    expect(gameCount(3)).toBe('3 games');
  });
  it('summarizes the groups', () => {
    const answer = heats({ stations: [{ number: 1, heat: null, calledAt: null }, { number: 2, heat: null, calledAt: null }], races: 2 });
    expect(groupsSummary(answer)).toBe('Races and free-for-all, 2 stations. Each group plays 2 games. Points for 1st to 4th: 4, 3, 2, 1.');
  });
  it('leaves the points out when 2 to 4 players play only the final', () => {
    const answer = heats({ rounds: 0, races: 1, stations: [{ number: 1, heat: null, calledAt: null }] });
    expect(groupsSummary(answer)).toBe('Races and free-for-all, 1 station. Each group plays 1 game.');
  });
  it('names the phase', () => {
    expect(phaseWords(heats({ round: 2 }))).toBe('Round 2 of 2');
    expect(phaseWords(heats({ round: null, ties: [{ place: 4, players: [zap, kai], started: false }] }))).toBe('Tie-break');
    expect(phaseWords(heats({ round: null }))).toBe('Final');
    expect(phaseWords(heats({ round: null, rounds: 0, heats: [heat(2000, { kind: 'final' })] }))).toBe('Final');
    expect(phaseWords(heats({ round: null, finished: true }))).toBe('Finished');
  });
  it('lists done groups newest result first', () => {
    const answer = heats({
      heats: [heat(1, { status: 'done', resultId: 1 }), heat(2, { status: 'done', resultId: 3 }), heat(3, { status: 'playing' }), heat(4, { status: 'done', resultId: 2 })],
    });
    expect(doneHeats(answer).map((h) => h.id)).toEqual([2, 4, 1]);
  });
  it('finds every player in the groups, standings included', () => {
    const answer = heats({ heats: [heat(1, { players: [zap, kai] })], standings: [{ place: 1, player: blaze, points: 0, heatsPlayed: 0 }] });
    expect([...playersInHeats(answer)].sort()).toEqual([1, 2, 3]);
  });
});
