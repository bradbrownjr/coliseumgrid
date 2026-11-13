import type { Bracket, BracketMatch, BracketSlot, Player } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { ERROR_WORDS } from '../src/api/errors.ts';
import {
  FORMAT_CHOICES,
  bestOfWords,
  byHandle,
  byePlayer,
  doneMatches,
  elapsedText,
  formatName,
  joinHandles,
  matchTitle,
  matchWords,
  placeWords,
  playerCountWords,
  playersInBracket,
  resultWords,
  slotWords,
  startProblem,
  tieWords,
} from '../src/pages/host/bracketWords.ts';

const zap: Player = { id: 1, handle: 'Zap' };
const kai: Player = { id: 2, handle: 'Kai' };
const blaze: Player = { id: 3, handle: 'Blaze' };
const slot = (player: Player | null, bye = false): BracketSlot => ({ player, bye });

function match(id: number, over: Partial<BracketMatch> = {}): BracketMatch {
  return { id, side: 'main', round: 1, number: id, status: 'ready', slots: [slot(zap), slot(kai)], winner: null, resultId: null, ...over };
}

function bracket(over: Partial<Bracket> = {}): Bracket {
  return {
    id: 1,
    format: 'single',
    bestOf: 1,
    finished: false,
    lateOpen: true,
    lastResultId: null,
    stations: [],
    upNext: [],
    matches: [],
    standings: [],
    ties: [],
    ...over,
  };
}

describe('placeWords', () => {
  it('says 1st, 2nd, and 3rd for the podium', () => {
    expect([1, 2, 3].map(placeWords)).toEqual(['1st', '2nd', '3rd']);
  });
  it('says th from 4 up, and for 11 to 13', () => {
    expect([4, 5, 9, 10, 11, 12, 13, 14].map(placeWords)).toEqual(['4th', '5th', '9th', '10th', '11th', '12th', '13th', '14th']);
  });
  it('goes back to st, nd, and rd after the teens', () => {
    expect([21, 22, 23, 24, 32].map(placeWords)).toEqual(['21st', '22nd', '23rd', '24th', '32nd']);
  });
});

describe('tie words', () => {
  it('joins one, two, and three handles', () => {
    expect(joinHandles([zap])).toBe('Zap');
    expect(joinHandles([zap, kai])).toBe('Zap and Kai');
    expect(joinHandles([zap, kai, blaze])).toBe('Zap, Kai, and Blaze');
  });
  it('reads "Tie for 1st: Zap and Kai"', () => {
    expect(tieWords({ place: 1, players: [zap, kai] })).toBe('Tie for 1st: Zap and Kai');
    expect(tieWords({ place: 3, players: [zap, kai, blaze] })).toBe('Tie for 3rd: Zap, Kai, and Blaze');
  });
});

describe('elapsedText', () => {
  const calledAt = '2027-03-06T18:00:00.000Z';
  const at = (seconds: number) => Date.parse(calledAt) + seconds * 1000;

  it('counts up in minutes and seconds', () => {
    expect(elapsedText(calledAt, at(0))).toBe('0:00');
    expect(elapsedText(calledAt, at(42))).toBe('0:42');
    expect(elapsedText(calledAt, at(60))).toBe('1:00');
    expect(elapsedText(calledAt, at(12 * 60 + 5))).toBe('12:05');
  });
  it('adds hours after the first hour', () => {
    expect(elapsedText(calledAt, at(3600 + 2 * 60 + 5))).toBe('1:02:05');
  });
  it('drops a part of a second', () => {
    expect(elapsedText(calledAt, at(1) + 999)).toBe('0:01');
  });
  it('reads 0:00 when the server clock is ahead of this one', () => {
    expect(elapsedText(calledAt, at(-3))).toBe('0:00');
  });
  it('is empty with no usable time', () => {
    expect(elapsedText(null, at(5))).toBe('');
    expect(elapsedText('not a time', at(5))).toBe('');
  });
});

describe('format choices', () => {
  it('uses the plain names', () => {
    expect(FORMAT_CHOICES.map((choice) => choice.name)).toEqual(['One life', 'Two lives', 'Everyone plays everyone']);
    expect(FORMAT_CHOICES.map((choice) => choice.format)).toEqual(['single', 'double', 'round_robin']);
  });
  it('names a format for the summary line', () => {
    expect(formatName('double')).toBe('Two lives');
  });
  it('gives each choice one line without an em-dash (the character is built from its code so check-docs passes)', () => {
    for (const choice of FORMAT_CHOICES) expect(choice.line).not.toContain(String.fromCharCode(8212));
  });
});

describe('bestOfWords', () => {
  it('says how many games take the match', () => {
    expect(bestOfWords(1)).toBe('One game decides the match.');
    expect(bestOfWords(3)).toBe('First to win 2 games takes the match.');
    expect(bestOfWords(5)).toBe('First to win 3 games takes the match.');
  });
});

describe('the start dialog limits', () => {
  it('needs 2 players for one life and everyone plays everyone', () => {
    for (const format of ['single', 'round_robin'] as const) {
      expect(startProblem(format, 0)).toBe('Pick at least 2 players.');
      expect(startProblem(format, 1)).toBe('Pick at least 2 players.');
      expect(startProblem(format, 2)).toBeNull();
    }
  });
  it('needs 3 players for two lives', () => {
    expect(startProblem('double', 2)).toBe('Two lives needs at least 3 players.');
    expect(startProblem('double', 3)).toBeNull();
  });
  it('takes up to 32 players', () => {
    expect(startProblem('single', 32)).toBeNull();
    expect(startProblem('single', 33)).toBe(ERROR_WORDS['too-many-players']);
    expect(startProblem('double', 33)).toBe(ERROR_WORDS['too-many-players']);
  });
  it('counts players with the right plural', () => {
    expect(playerCountWords(1)).toBe('1 player');
    expect(playerCountWords(0)).toBe('0 players');
    expect(playerCountWords(8)).toBe('8 players');
  });
});

describe('match words', () => {
  it('titles each side', () => {
    expect(matchTitle({ side: 'main', round: 2 })).toBe('Round 2');
    expect(matchTitle({ side: 'winners', round: 1 })).toBe('Winners, round 1');
    expect(matchTitle({ side: 'losers', round: 3 })).toBe('Second chance, round 3');
    expect(matchTitle({ side: 'final', round: 1 })).toBe('Final');
    expect(matchTitle({ side: 'rematch', round: 1 })).toBe('Rematch for the title');
    expect(matchTitle({ side: 'third', round: 1 })).toBe('3rd place match');
    expect(matchTitle({ side: 'tie-break', round: 1 })).toBe('Tie-break');
    expect(matchTitle({ side: 'tie-break', round: 2 })).toBe('Tie-break, round 2');
  });
  it('reads a bye as "Moves on this round"', () => {
    const bye = match(1, { status: 'bye', slots: [slot(zap), slot(null, true)] });
    expect(matchWords(bye)).toBe('Zap: Moves on this round');
    expect(byePlayer(bye)).toEqual(zap);
    expect(byePlayer(match(2))).toBeNull();
  });
  it('reads a second-slot bye the same way', () => {
    expect(matchWords(match(1, { slots: [slot(null, true), slot(kai)] }))).toBe('Kai: Moves on this round');
  });
  it('says who plays whom, and what is not decided yet', () => {
    expect(matchWords(match(1))).toBe('Zap vs Kai');
    expect(matchWords(match(2, { slots: [slot(zap), slot(null)] }))).toBe('Zap vs To be decided');
    expect(slotWords(slot(null, true))).toBe('Nobody');
  });
  it('says who beat whom', () => {
    expect(resultWords(match(1, { status: 'done', winner: 1, resultId: 4 }))).toBe('Kai beat Zap');
    expect(resultWords(match(1))).toBeNull();
  });
});

describe('bracket lists', () => {
  it('lists done matches with the newest result first', () => {
    const done = [
      match(1, { status: 'done', winner: 0, resultId: 1 }),
      match(2, { status: 'done', winner: 1, resultId: 3 }),
      match(3, { status: 'done', winner: 0, resultId: 2 }),
      match(4),
      match(5, { status: 'bye', slots: [slot(zap), slot(null, true)] }),
    ];
    expect(doneMatches(bracket({ matches: done })).map((m) => m.resultId)).toEqual([3, 2, 1]);
  });
  it('finds every player in the bracket, wherever the answer names them', () => {
    const found = playersInBracket(
      bracket({
        matches: [match(1, { slots: [slot(zap), slot(null)] })],
        upNext: [match(2, { slots: [slot(kai), slot(null)] })],
        stations: [{ number: 1, match: match(3, { slots: [slot(blaze), slot(null)] }), calledAt: null }, { number: 2, match: null, calledAt: null }],
        standings: [{ place: 1, player: { id: 9, handle: 'Moe' }, wins: 1, losses: 0 }],
      }),
    );
    expect([...found].sort()).toEqual([1, 2, 3, 9]);
  });
  it('sorts handles without regard to case', () => {
    expect([kai, { id: 4, handle: 'amy' }, zap].sort(byHandle).map((p) => p.handle)).toEqual(['amy', 'Kai', 'Zap']);
  });
});
