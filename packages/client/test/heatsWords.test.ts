import type { Heats, Player, TieNotice } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { cutAfter, cutWords, heatCutAfter, heatTieMessage, noResultsYet } from '../src/heatsWords.ts';
import { joinHandles } from '../src/handles.ts';
import { showStandings } from '../src/pages/host/groupWords.ts';

const player = (id: number, handle = `P${id}`): Player => ({ id, handle });
const row = (place: number, id: number, points: number, heatsPlayed = 2) => ({ place, player: player(id), points, heatsPlayed });
function heats(extra: Partial<Heats> = {}): Heats {
  return {
    id: 1,
    races: 3,
    rounds: 2,
    points: [4, 3, 2, 1],
    finished: false,
    lateOpen: false,
    lastResultId: null,
    noShowMinutes: 5,
    round: 1,
    stations: [],
    upNext: [],
    heats: [],
    standings: [],
    finalSize: 4,
    ties: [],
    ...extra,
  };
}

describe('joinHandles', () => {
  it('joins with and, and a serial comma', () => {
    expect(joinHandles([player(1, 'Zap')])).toBe('Zap');
    expect(joinHandles([player(1, 'Zap'), player(2, 'Kai')])).toBe('Zap and Kai');
    expect(joinHandles([player(1, 'Zap'), player(2, 'Kai'), player(3, 'Mo')])).toBe('Zap, Kai, and Mo');
  });
});

describe('the cut line', () => {
  const standings = [row(1, 1, 8), row(2, 2, 7), row(3, 3, 6), row(3, 4, 6), row(3, 5, 6), row(3, 6, 6), row(7, 7, 3)];
  const tie = (ids: number[]): TieNotice => ({ place: 3, players: ids.map((id) => player(id)), started: false });

  it('goes under 4th with no tie, and nowhere when everyone reaches the final', () => {
    expect(cutAfter(32, 4)).toBe(4);
    expect(heatCutAfter(heats({ standings: [1, 2, 3, 4, 5, 6].map((id) => row(id, id, 10 - id)) }))).toBe(4);
    expect(heatCutAfter(heats({ standings: [row(1, 1, 0), row(2, 2, 0)], finalSize: 2 }))).toBeNull();
  });
  it('goes above the whole tied group, under the players who are surely in', () => {
    expect(heatCutAfter(heats({ standings, ties: [tie([3, 4, 5, 6])] }))).toBe(2);
  });
  it('goes above the first row when everyone is level at the cut', () => {
    const level = [1, 2, 3, 4, 5].map((id) => row(1, id, 4));
    expect(heatCutAfter(heats({ standings: level, ties: [tie([1, 2, 3, 4, 5])] }))).toBe(0);
  });
});

describe('the tie notice', () => {
  const standings = [row(1, 1, 8), row(2, 2, 7), row(3, 3, 6), row(3, 4, 6), row(3, 5, 6), row(3, 6, 6), row(7, 7, 3)];
  it('words a tie by what is at stake', () => {
    const four: TieNotice = { place: 3, players: [3, 4, 5, 6].map((id) => player(id, `T${id}`)), started: false };
    const state = heats({ standings, ties: [four] });
    expect(heatTieMessage(four, state)).toBe('T3, T4, T5, and T6 are tied. 2 of them go to the final. Tie-break group coming up.');
    expect(heatTieMessage({ ...four, started: true }, state)).toBe('T3, T4, T5, and T6 are tied. 2 of them go to the final. Playing the tie-break group.');
  });
  it('says "1 of them goes" for one spot', () => {
    const two: TieNotice = { place: 4, players: [player(4, 'Zap'), player(5, 'Kai')], started: false };
    const state = heats({ standings: [row(1, 1, 8), row(2, 2, 7), row(3, 3, 6), row(4, 4, 5), row(4, 5, 5)], ties: [two] });
    expect(heatTieMessage(two, state)).toBe('Zap and Kai are tied. 1 of them goes to the final. Tie-break group coming up.');
  });
});

describe('before the first result', () => {
  it('has no results while every player has played no groups', () => {
    expect(noResultsYet(heats({ standings: [row(1, 1, 0, 0), row(1, 2, 0, 0)] }))).toBe(true);
    expect(noResultsYet(heats({ standings: [row(1, 1, 4, 1), row(2, 2, 0, 0)] }))).toBe(false);
    expect(noResultsYet(heats())).toBe(false);
  });
  it('shows the host no standings until a group has a result', () => {
    expect(showStandings(heats({ standings: [row(1, 1, 0, 0), row(1, 2, 0, 0)] }))).toBe(false);
    expect(showStandings(heats({ standings: [row(1, 1, 4, 1), row(2, 2, 0, 0)] }))).toBe(true);
  });
});

describe('cutWords', () => {
  it('names the places that go to the final', () => {
    expect(cutWords(4)).toBe('Top 4 go to the final');
  });
});
