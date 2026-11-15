import type { Heat, HeatKind, HeatStation, Heats, Player, TieNotice } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import {
  bracketStationCards,
  bracketUpNext,
  finalHeat,
  finalists,
  heatLabel,
  heatLines,
  heatRoundText,
  heatStationCards,
  heatStationLayout,
  heatTableType,
  heatUpNext,
  pointsText,
  splitPodium,
  splitTable,
  tableTypeFor,
} from '../src/pages/display/model.ts';
import { cutAfter, heatCutAfter, heatTieMessage, noResultsYet } from '../src/heatsWords.ts';

const player = (id: number, handle = `P${id}`): Player => ({ id, handle });
const group = (ids: number[], kind: HeatKind = 'round', number = 1, status: Heat['status'] = 'ready'): Heat => ({
  id: kind === 'final' ? 2000 : kind === 'tie-break' ? 1001 : number,
  kind,
  round: 1,
  number,
  status,
  players: ids.map((id) => player(id)),
  order: null,
  missing: [],
  resultId: null,
});

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
const row = (place: number, id: number, points: number, heatsPlayed = 2) => ({ place, player: player(id), points, heatsPlayed });

describe('what a group is called', () => {
  it('says Group, Tie-break group, and Final, never heat', () => {
    expect(heatLabel(group([1, 2, 3, 4], 'round', 3))).toBe('Group 3');
    expect(heatLabel(group([1, 2], 'tie-break'))).toBe('Tie-break group');
    expect(heatLabel(group([1, 2, 3, 4], 'final'))).toBe('Final');
  });
});

describe('station cards', () => {
  const stations: HeatStation[] = [
    { number: 1, heat: group([1, 2, 3, 4], 'round', 3, 'playing'), calledAt: '2027-01-01T00:00:00Z', arrived: false },
    { number: 2, heat: group([5, 6], 'tie-break', 1, 'playing'), calledAt: null, arrived: false },
    { number: 3, heat: null, calledAt: null, arrived: false },
  ];

  it('lists up to four handles and names the group after the station', () => {
    const cards = heatStationCards(stations);
    expect(cards[0]).toMatchObject({ number: 1, note: 'Group 3', calledAt: '2027-01-01T00:00:00Z' });
    expect(cards[0]?.slots.map((slot) => slot.player?.handle)).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(cards[1]?.note).toBe('Tie-break group');
  });

  it('leaves an idle station empty', () => {
    expect(heatStationCards(stations)[2]).toEqual({ number: 3, note: null, slots: [], calledAt: null, arrived: false });
  });

  it('keeps a bracket card as it was: the note only for a tie-break match', () => {
    const slots = [{ player: player(1), bye: false }, { player: player(2), bye: false }] as const;
    const base = { id: 1, round: 1, number: 1, status: 'playing' as const, slots: [...slots] as [typeof slots[0], typeof slots[1]], winner: null, forfeit: false, resultId: null };
    const cards = bracketStationCards([
      { number: 1, match: { ...base, side: 'main' }, calledAt: 'x', arrived: false },
      { number: 2, match: { ...base, side: 'tie-break' }, calledAt: 'y', arrived: false },
      { number: 3, match: null, calledAt: null, arrived: false },
    ]);
    expect(cards.map((card) => card.note)).toEqual([null, 'tie-break', null]);
    expect(cards[2]?.slots).toEqual([]);
  });
});

describe('Up next', () => {
  it('prefixes each group and lists its players', () => {
    const entries = heatUpNext([group([1, 2, 3], 'round', 4), group([1, 2, 3, 4], 'final')]);
    expect(entries.map((entry) => entry.prefix)).toEqual(['Group 4:', 'Final:']);
    expect(entries[0]?.names).toEqual(['P1', 'P2', 'P3']);
    expect(entries[0]?.separator).toBeNull();
  });

  it('keeps "Tie-break:" and "vs" for a bracket', () => {
    const slot = (id: number | null) => ({ player: id === null ? null : player(id), bye: false });
    const entries = bracketUpNext([
      { id: 7, side: 'tie-break', round: 1, number: 1, status: 'ready', slots: [slot(1), slot(null)], winner: null, forfeit: false, resultId: null },
    ]);
    expect(entries[0]).toMatchObject({ prefix: 'Tie-break:', names: ['P1', 'Waiting'], separator: 'vs' });
  });
});

describe('standings by points', () => {
  it('shows points and qualifying groups played, and tags players in an open tie', () => {
    const tie: TieNotice = { place: 4, players: [player(4), player(5)], started: false };
    const lines = heatLines(heats({ standings: [row(1, 1, 8), row(2, 2, 7), row(3, 3, 6), row(4, 4, 5), row(4, 5, 5), row(6, 6, 3)], ties: [tie] }));
    expect(lines.map((line) => [line.place, line.first, line.second, line.note])).toEqual([
      [1, 8, 2, null],
      [2, 7, 2, null],
      [3, 6, 2, null],
      [4, 5, 2, 'Tie'],
      [4, 5, 2, 'Tie'],
      [6, 3, 2, null],
    ]);
  });

  it('draws the cut under the finalists, and not at all when everyone reaches the final', () => {
    expect(cutAfter(10, 4)).toBe(4);
    expect(cutAfter(32, 4)).toBe(4);
    expect(cutAfter(4, 4)).toBeNull();
    expect(cutAfter(3, 3)).toBeNull();
    expect(cutAfter(0, 0)).toBeNull();
  });

  it('keeps the cut inside the first table when 32 rows split in two', () => {
    const halves = splitTable(Array.from({ length: 32 }, (_, i) => i));
    expect(halves.map((half) => half.length)).toEqual([16, 16]);
    expect(cutAfter(32, 4)).toBeLessThanOrEqual(halves[0]?.length ?? 0);
  });
});

describe('round and tie words', () => {
  it('reads "Round 1 of 2" while qualifying, and nothing after', () => {
    expect(heatRoundText(heats({ round: 1, rounds: 2 }))).toBe('Round 1 of 2');
    expect(heatRoundText(heats({ round: 3, rounds: 3 }))).toBe('Round 3 of 3');
    expect(heatRoundText(heats({ round: null }))).toBeNull();
    expect(heatRoundText(heats({ round: null, rounds: 0 }))).toBeNull();
  });

  it('words a tie at the cut by what is at stake', () => {
    const standings = [row(1, 1, 8), row(2, 2, 7), row(3, 3, 6), row(3, 4, 6), row(3, 5, 6), row(3, 6, 6), row(7, 7, 3)];
    const four: TieNotice = { place: 3, players: [3, 4, 5, 6].map((id) => player(id, `T${id}`)), started: false };
    const state = heats({ standings, ties: [four] });
    expect(heatTieMessage(four, state)).toBe('T3, T4, T5, and T6 are tied. 2 of them go to the final. Tie-break group coming up.');
    expect(heatTieMessage({ ...four, started: true }, state)).toBe('T3, T4, T5, and T6 are tied. 2 of them go to the final. Playing the tie-break group.');
  });

  it('says "1 of them goes" for one spot, and names no spots for a tie that does not reach the cut', () => {
    const standings = [row(1, 1, 8), row(2, 2, 7), row(3, 3, 6), row(4, 4, 5), row(4, 5, 5)];
    const two: TieNotice = { place: 4, players: [player(4, 'Zap'), player(5, 'Kai')], started: false };
    expect(heatTieMessage(two, heats({ standings, ties: [two] }))).toBe('Zap and Kai are tied. 1 of them goes to the final. Tie-break group coming up.');
    expect(heatTieMessage(two, heats({ standings: [], ties: [two] }))).toBe('Zap and Kai are tied. Tie-break group coming up.');
  });

  it('says 1 point and 12 points', () => {
    expect(pointsText(1)).toBe('1 point');
    expect(pointsText(0)).toBe('0 points');
    expect(pointsText(12)).toBe('12 points');
  });
});

describe('the final', () => {
  it('finds the final once it is made', () => {
    expect(finalHeat(heats({ heats: [group([1, 2, 3, 4])] }))).toBeNull();
    const final = group([4, 3, 2, 1], 'final', 1, 'playing');
    expect(finalHeat(heats({ heats: [group([1, 2, 3, 4]), final] }))).toBe(final);
  });

  it('lists the finalists best qualifier first, with their points', () => {
    const final = group([3, 1, 4, 2], 'final', 1, 'playing');
    const state = heats({ standings: [row(1, 1, 8), row(2, 2, 7), row(3, 3, 6), row(4, 4, 5), row(5, 5, 4)] });
    expect(finalists(state, final).map((f) => [f.player.id, f.points])).toEqual([[1, 8], [2, 7], [3, 6], [4, 5]]);
  });

  it('shows no points when the final is the only group', () => {
    const final = group([2, 1], 'final', 1, 'playing');
    expect(finalists(heats({ rounds: 0, round: null, standings: [row(1, 1, 0, 0), row(1, 2, 0, 0)], finalSize: 2 }), final).map((f) => f.points)).toEqual([null, null]);
  });

  it('puts places 1 to 3 on the podium and place 4 below it', () => {
    const { podium, rest } = splitPodium([row(4, 4, 5), row(1, 1, 8), row(3, 3, 6), row(2, 2, 7), row(5, 5, 4)]);
    expect(podium.map((place) => place.place)).toEqual([1, 2, 3]);
    expect(rest.map((r) => r.place)).toEqual([4, 5]);
  });
});

describe('group station layout', () => {
  it('uses one column up to four stations on the TV, and two from five; the laptop goes to two from three', () => {
    expect([1, 2, 4, 5, 8].map((count) => heatStationLayout(count, 'tv').columns)).toEqual([1, 1, 1, 2, 2]);
    expect([1, 2, 3, 4, 8].map((count) => heatStationLayout(count, 'laptop').columns)).toEqual([1, 1, 2, 2, 2]);
    expect(heatStationLayout(8, 'phone')).toEqual({ columns: 1, variant: 'h6' });
  });

  it('never sets the type larger as stations are added', () => {
    const order = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'subtitle1', 'body1', 'body2'];
    for (const screen of ['tv', 'laptop'] as const) {
      const sizes = [1, 2, 3, 4, 5, 8].map((count) => order.indexOf(heatStationLayout(count, screen).variant));
      expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    }
  });
});

describe('points table type', () => {
  it('is a step larger than a bracket table on the TV at 9 and 10 rows, and the same elsewhere', () => {
    expect(heatTableType(10, 'tv')).toBe('h4');
    expect(heatTableType(11, 'tv')).toBe('h5');
    expect(heatTableType(16, 'tv')).toBe('h5');
    expect(heatTableType(6, 'tv')).toBe('h3');
    expect(heatTableType(10, 'laptop')).toBe(tableTypeFor(10, 'laptop'));
    expect(heatTableType(10, 'phone')).toBe('h6');
  });
});

describe('the cut with a tie', () => {
  const standings = [row(1, 1, 8), row(2, 2, 7), row(3, 3, 6), row(3, 4, 6), row(3, 5, 6), row(3, 6, 6), row(7, 7, 3)];
  const tie = (ids: number[]): TieNotice => ({ place: 3, players: ids.map((id) => player(id)), started: false });

  it('goes above the whole tied group, under the players who are surely in', () => {
    expect(heatCutAfter(heats({ standings, ties: [tie([3, 4, 5, 6])] }))).toBe(2);
  });

  it('goes above the first row when everyone is level at the cut', () => {
    const level = [1, 2, 3, 4, 5].map((id) => row(1, id, 4));
    expect(heatCutAfter(heats({ standings: level, ties: [tie([1, 2, 3, 4, 5])] }))).toBe(0);
  });

  it('goes under 4th with no tie, and nowhere when everyone reaches the final', () => {
    expect(heatCutAfter(heats({ standings: [1, 2, 3, 4, 5, 6].map((id) => row(id, id, 10 - id)) }))).toBe(4);
    expect(heatCutAfter(heats({ standings: [row(1, 1, 0), row(2, 2, 0)], finalSize: 2 }))).toBeNull();
  });
});

describe('before the first result', () => {
  it('has no results while every player has played no groups', () => {
    expect(noResultsYet(heats({ standings: [row(1, 1, 0, 0), row(1, 2, 0, 0)] }))).toBe(true);
    expect(noResultsYet(heats({ standings: [row(1, 1, 4, 1), row(2, 2, 0, 0)] }))).toBe(false);
    expect(noResultsYet(heats())).toBe(false);
  });
});
