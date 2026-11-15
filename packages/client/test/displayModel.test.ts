import type { Bracket, BracketMatch, MatchSide, MatchStatus, Player } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import {
  MAX_PER_COLUMN,
  buildSections,
  chunk,
  densityFor,
  elapsedText,
  loserWords,
  ordinal,
  scaleType,
  sectionRows,
  singleRoundName,
  splitPodium,
  splitTable,
  stationCallLine,
  stationLayout,
  stepDown,
  tableTypeFor,
  tieMessage,
  totalRows,
  windowRounds,
} from '../src/pages/display/model.ts';
import { joinHandles } from '../src/handles.ts';

const player = (id: number, handle = `P${id}`): Player => ({ id, handle });
let nextId = 1;
function match(side: MatchSide, round: number, number: number, status: MatchStatus = 'waiting', extra: Partial<BracketMatch> = {}): BracketMatch {
  return {
    id: nextId++,
    side,
    round,
    number,
    status,
    slots: [
      { player: status === 'waiting' ? null : player(number * 2 - 1), bye: false },
      { player: status === 'waiting' ? null : player(number * 2), bye: false },
    ],
    winner: status === 'done' ? 0 : null,
    forfeit: false,
    resultId: null,
    ...extra,
  };
}
const round = (side: MatchSide, n: number, count: number, status: MatchStatus) =>
  Array.from({ length: count }, (_, i) => match(side, n, i + 1, status));

function bracket(format: Bracket['format'], matches: BracketMatch[]): Bracket {
  return { id: 1, format, bestOf: 1, finished: false, lateOpen: false, lastResultId: null, noShowMinutes: 5, stations: [], upNext: [], matches, standings: [], ties: [] };
}

describe('which rounds to show', () => {
  const five = [...round('main', 1, 16, 'done'), ...round('main', 2, 8, 'done'), ...round('main', 3, 4, 'ready'), ...round('main', 4, 2, 'waiting'), ...round('main', 5, 1, 'waiting')];

  it('starts at the earliest unfinished round and shows two more', () => {
    expect(windowRounds(five)).toEqual([3, 4, 5]);
    expect(windowRounds([...round('main', 1, 16, 'ready'), ...round('main', 2, 8, 'waiting'), ...round('main', 3, 4, 'waiting'), ...round('main', 4, 2, 'waiting')])).toEqual([1, 2, 3]);
  });

  it('shows fewer when the end of the bracket is near', () => {
    const late = [...round('main', 1, 4, 'done'), ...round('main', 2, 2, 'done'), ...round('main', 3, 1, 'playing')];
    expect(windowRounds(late)).toEqual([3]);
  });

  it('counts a bye as finished', () => {
    const byes = [match('main', 1, 1, 'bye'), match('main', 1, 2, 'done'), ...round('main', 2, 1, 'ready')];
    expect(windowRounds(byes)).toEqual([2]);
  });

  it('takes the earliest unfinished round even when a later one has finished matches', () => {
    const mixed = [match('main', 1, 1, 'playing'), match('main', 1, 2, 'done'), match('main', 2, 1, 'done')];
    expect(windowRounds(mixed)).toEqual([1, 2]);
  });

  it('shows the last round once everything is finished', () => {
    expect(windowRounds([...round('main', 1, 2, 'done'), ...round('main', 2, 1, 'done')])).toEqual([2]);
  });

  it('has nothing to show for no matches', () => {
    expect(windowRounds([])).toEqual([]);
  });
});

describe('columns and sections', () => {
  it('wraps a long round into columns of at most 8', () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], MAX_PER_COLUMN).map((c) => c.length)).toEqual([8, 2]);
    const single = bracket('single', [...round('main', 1, 16, 'ready'), ...round('main', 2, 8, 'waiting'), ...round('main', 3, 4, 'waiting'), ...round('main', 4, 2, 'waiting'), ...round('main', 5, 1, 'waiting')]);
    const [section] = buildSections(single);
    expect(section?.columns.map((c) => c.chunks.map((m) => m.length))).toEqual([[8, 8], [8], [4]]);
    expect(totalRows(buildSections(single))).toBe(8);
  });

  it('names the last two single elimination rounds and numbers the rest', () => {
    expect(singleRoundName(5, 5)).toBe('Final');
    expect(singleRoundName(4, 5)).toBe('Semi-finals');
    expect(singleRoundName(3, 5)).toBe('Round 3');
    const single = bracket('single', [...round('main', 1, 4, 'done'), ...round('main', 2, 2, 'ready'), ...round('main', 3, 1, 'waiting')]);
    expect(buildSections(single)[0]?.columns.map((c) => c.heading)).toEqual(['Semi-finals', 'Final']);
  });

  it('hangs the 3rd-place match under the final, and only when the final is shown', () => {
    const third = match('third', 1, 1, 'waiting');
    const early = bracket('single', [...round('main', 1, 8, 'ready'), ...round('main', 2, 4, 'waiting'), ...round('main', 3, 2, 'waiting'), ...round('main', 4, 1, 'waiting'), third]);
    expect(buildSections(early)[0]?.columns.some((c) => c.extra)).toBe(false);
    const late = bracket('single', [...round('main', 1, 4, 'done'), ...round('main', 2, 2, 'ready'), ...round('main', 3, 1, 'waiting'), third]);
    const final = buildSections(late)[0]?.columns.find((c) => c.heading === 'Final');
    expect(final?.extra).toEqual({ heading: '3rd place match', match: third });
    expect(sectionRows(buildSections(late)[0]!)).toBe(2);
  });

  it('groups two lives into No losses, One life left, and Final', () => {
    const rematch = match('rematch', 1, 1, 'waiting');
    const double = bracket('double', [
      ...round('winners', 1, 4, 'done'),
      ...round('winners', 2, 2, 'ready'),
      ...round('winners', 3, 1, 'waiting'),
      ...round('losers', 1, 2, 'ready'),
      ...round('losers', 2, 2, 'waiting'),
      match('final', 1, 1, 'waiting'),
      rematch,
    ]);
    const sections = buildSections(double);
    expect(sections.map((s) => s.title)).toEqual(['No losses', 'One life left', 'Final']);
    expect(sections[0]?.columns.map((c) => c.heading)).toEqual(['Round 2', 'Round 3']);
    expect(sections[1]?.columns.map((c) => c.heading)).toEqual(['Round 1', 'Round 2']);
    expect(sections[2]?.columns.map((c) => c.heading)).toEqual(['First match', 'Rematch for the title']);
  });

  it('leaves out the rematch when the bracket has none', () => {
    const double = bracket('double', [...round('winners', 1, 1, 'ready'), match('final', 1, 1, 'waiting')]);
    expect(buildSections(double).at(-1)?.columns.map((c) => c.heading)).toEqual([null]);
  });

  it('draws a bye match with nobody in it as nothing', () => {
    const empty = match('losers', 1, 1, 'bye', { slots: [{ player: null, bye: true }, { player: null, bye: true }] });
    const double = bracket('double', [...round('winners', 1, 2, 'ready'), empty, ...round('losers', 2, 1, 'waiting')]);
    expect(buildSections(double)[1]?.columns.map((c) => c.heading)).toEqual(['Round 2']);
  });

  it('has no sections for a round robin', () => {
    expect(buildSections(bracket('round_robin', round('main', 1, 3, 'ready')))).toEqual([]);
  });
});

describe('type size', () => {
  it('shrinks as more cards stack on the TV, and goes to one line when crowded', () => {
    const picks = [1, 3, 8, 10, 16, 20].map((rows) => densityFor(rows, 'tv'));
    expect(picks.map((d) => d.variant)).toEqual(['h3', 'h4', 'h5', 'h6', 'h5', 'h6']);
    expect(picks.map((d) => d.compact)).toEqual([false, false, false, false, true, true]);
  });

  it('uses smaller cards on a laptop, and never squeezes a phone', () => {
    expect(densityFor(8, 'laptop')).toEqual({ variant: 'h5', compact: true });
    expect(tableTypeFor(16, 'tv')).toBe('h5');
    expect(tableTypeFor(16, 'laptop')).toBe('subtitle1');
    expect(densityFor(30, 'laptop')).toEqual({ variant: 'body2', compact: true, tight: true });
    expect(densityFor(40, 'phone')).toEqual({ variant: 'h6', compact: false });
  });

  it('counts a section title as one more card', () => {
    const column = (n: number) => ({ key: 'c', heading: null, chunks: [Array.from({ length: n }, () => match('main', 1, 1))] });
    const titled = { key: 'a', title: 'No losses', columns: [column(4)] };
    const plain = { key: 'b', title: null, columns: [column(4)] };
    expect(totalRows([plain])).toBe(4);
    expect(totalRows([titled, titled])).toBe(10);
  });

  it('steps down for smaller screens and never leaves the ladder', () => {
    expect(stepDown('h5', 2)).toBe('subtitle1');
    expect(stepDown('body1', 5)).toBe('body2');
    expect(stepDown('h1', 1)).toBe('h2');
    expect(scaleType('h4')).toEqual({ xs: 'h6', md: 'h6', lg: 'h5', xl: 'h4' });
    expect(scaleType('body1').xs).toBe('body1');
  });

  it('puts many stations in two columns, except on a phone', () => {
    expect(stationLayout(2, 'tv')).toEqual({ columns: 1, variant: 'h4' });
    expect(stationLayout(8, 'tv')).toEqual({ columns: 2, variant: 'h6' });
    expect(stationLayout(8, 'laptop').columns).toBe(2);
    expect(stationLayout(8, 'phone').columns).toBe(1);
  });

  it('splits a long table into two halves', () => {
    expect(splitTable(Array.from({ length: 16 }, (_, i) => i))).toHaveLength(1);
    expect(splitTable(Array.from({ length: 17 }, (_, i) => i)).map((t) => t.length)).toEqual([9, 8]);
  });
});

describe('timer text', () => {
  const start = '2026-11-13T18:00:00.000Z';
  const at = (seconds: number) => Date.parse(start) + seconds * 1000;

  it('counts up in minutes and seconds', () => {
    expect(elapsedText(start, at(0))).toBe('0:00');
    expect(elapsedText(start, at(7))).toBe('0:07');
    expect(elapsedText(start, at(59.9))).toBe('0:59');
    expect(elapsedText(start, at(754))).toBe('12:34');
  });

  it('adds hours past the hour', () => {
    expect(elapsedText(start, at(3600))).toBe('1:00:00');
    expect(elapsedText(start, at(3723))).toBe('1:02:03');
  });

  it('shows 0:00 when the TV clock is behind the server', () => {
    expect(elapsedText(start, at(-30))).toBe('0:00');
  });

  it('is empty without a readable start', () => {
    expect(elapsedText(null, at(5))).toBeNull();
    expect(elapsedText('not a time', at(5))).toBeNull();
  });
});

describe('words', () => {
  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
  });

  it('joins handles', () => {
    expect(joinHandles([player(1, 'Zap')])).toBe('Zap');
    expect(joinHandles([player(1, 'Zap'), player(2, 'Kai')])).toBe('Zap and Kai');
    expect(joinHandles([player(1, 'Zap'), player(2, 'Kai'), player(3, 'Mo')])).toBe('Zap, Kai, and Mo');
  });

  it('announces a tie, before and during its tie-break', () => {
    const players = [player(1, 'Zap'), player(2, 'Kai')];
    expect(tieMessage({ place: 1, players, started: false })).toBe('Tie for 1st: Zap and Kai. Tie-break coming up.');
    expect(tieMessage({ place: 3, players, started: true })).toBe('Tie for 3rd: Zap and Kai. Playing the tie-break.');
  });

  it('says one life left for a first loss and out for the last', () => {
    expect(loserWords('double', match('winners', 1, 1), false)).toBe('One life left');
    expect(loserWords('double', match('losers', 1, 1), false)).toBe('Out');
    expect(loserWords('double', match('final', 1, 1), true)).toBe('One life left');
    expect(loserWords('double', match('final', 1, 1), false)).toBe('Out');
    expect(loserWords('double', match('rematch', 1, 1), true)).toBe('Out');
    expect(loserWords('single', match('main', 1, 1), false)).toBe('Out');
    expect(loserWords('single', match('third', 1, 1), false)).toBe('Out');
  });
});

describe('final standings', () => {
  const row = (place: number, handle: string) => ({ place, player: player(place * 10, handle), wins: 0, losses: 0 });

  it('puts places 1 to 3 on the podium and the rest in order', () => {
    const { podium, rest } = splitPodium([row(5, 'E'), row(2, 'B'), row(1, 'A'), row(4, 'D'), row(3, 'C'), row(5, 'F')]);
    expect(podium.map((g) => [g.place, g.rows.map((r) => r.player.handle)])).toEqual([[1, ['A']], [2, ['B']], [3, ['C']]]);
    expect(rest.map((r) => r.player.handle)).toEqual(['D', 'E', 'F']);
  });

  it('keeps players who share a place in one group', () => {
    const { podium } = splitPodium([row(1, 'A'), row(2, 'C'), row(2, 'B')]);
    expect(podium[1]?.rows.map((r) => r.player.handle)).toEqual(['B', 'C']);
  });
});

describe('the call line', () => {
  const calledAt = '2026-11-14T18:00:00.000Z';
  const now = (minutes: number) => Date.parse(calledAt) + minutes * 60_000;
  const card = (slots: { player: Player | null; bye: boolean }[]) => ({ number: 2, note: null, slots, calledAt });

  it('calls every player once the wait is over', () => {
    const match = card([{ player: player(1, 'Zap'), bye: false }, { player: player(2, 'Kai'), bye: false }]);
    expect(stationCallLine(match, 5, now(4))).toBeNull();
    expect(stationCallLine(match, 5, now(5))).toBe('Zap and Kai, come to station 2!');
    const group = card(['Zap', 'Kai', 'Blaze'].map((handle, i) => ({ player: player(i + 1, handle), bye: false })));
    expect(stationCallLine(group, 10, now(11))).toBe('Zap, Kai, and Blaze, come to station 2!');
  });

  it('shows nothing on an empty station', () => {
    expect(stationCallLine(card([]), 5, now(30))).toBeNull();
  });
});
