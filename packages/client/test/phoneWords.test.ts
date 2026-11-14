import type { FollowedPlayer, PhoneStandings } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import {
  baseTitle,
  calledTitle,
  calledWords,
  nextWords,
  othersWords,
  phoneCutAfter,
  standingsTable,
  statusWords,
} from '../src/pages/phone/phoneWords.ts';

const zap = { id: 3, handle: 'Zap' };
const kai = { id: 2, handle: 'Kai' };
const blaze = { id: 1, handle: 'Blaze' };

const followed = (extra: Partial<FollowedPlayer>): FollowedPlayer => ({
  player: zap,
  status: 'later',
  away: null,
  station: null,
  matchId: null,
  others: [],
  place: null,
  ...extra,
});

const bracket = (format: 'single' | 'round_robin' = 'single'): PhoneStandings => ({ kind: 'bracket', format, finished: false, rows: [] });
const heats = (rows: { place: number; points: number; heatsPlayed: number; id: number }[], finalSize = 4): PhoneStandings => ({
  kind: 'heats',
  finished: false,
  finalSize,
  rows: rows.map((r) => ({ place: r.place, points: r.points, heatsPlayed: r.heatsPlayed, player: { id: r.id, handle: `P${r.id}` } })),
});

describe('status words', () => {
  it('says where to go when called', () => {
    expect(statusWords(followed({ status: 'now', station: 2 }), bracket())).toBe("You're up! Go to station 2");
  });

  it('words each distance', () => {
    expect(statusWords(followed({ status: 'next', away: 1 }), bracket())).toBe("You're next");
    expect(statusWords(followed({ status: 'two-away', away: 2 }), bracket())).toBe('Two matches away');
    expect(statusWords(followed({ status: 'later', away: 5 }), bracket())).toBe('About 5 matches away');
  });

  it('says group where the event runs groups', () => {
    const rows = [{ place: 1, points: 4, heatsPlayed: 1, id: 1 }];
    expect(statusWords(followed({ status: 'two-away', away: 2 }), heats(rows))).toBe('Two groups away');
    expect(statusWords(followed({ status: 'waiting' }), heats(rows))).toBe('Waiting for your next group');
    expect(statusWords(followed({ status: 'waiting' }), bracket())).toBe('Waiting for your next match');
  });

  it('thanks a player who is out, and words a round robin differently', () => {
    expect(statusWords(followed({ status: 'out' }), bracket())).toBe("You're out. Thanks for playing!");
    expect(statusWords(followed({ status: 'out' }), bracket('round_robin'))).toBe('All your matches are played. Thanks for playing!');
  });

  it('gives the final place', () => {
    expect(statusWords(followed({ status: 'done', place: 3 }), bracket())).toBe('Finished 3rd');
    expect(statusWords(followed({ status: 'done', place: 11 }), bracket())).toBe('Finished 11th');
    expect(statusWords(followed({ status: 'done', place: 1 }), bracket())).toBe('You won! Finished 1st');
  });

  it('says so when nothing has started or the player is not in it', () => {
    expect(statusWords(followed({ status: 'not-in' }), null)).toBe("The host hasn't started yet");
    expect(statusWords(followed({ status: 'not-in' }), bracket())).toBe("You're not playing in this one");
  });
});

describe('who else is in it', () => {
  it('is one opponent in a match and the others in a group', () => {
    expect(othersWords({ others: [kai] }, bracket())).toBe('Against Kai');
    expect(othersWords({ others: [kai, blaze] }, heats([]))).toBe('With Kai and Blaze');
  });

  it('is null when nobody is known', () => {
    expect(othersWords({ others: [] }, bracket())).toBeNull();
  });
});

describe('alert words and titles', () => {
  it('names the station', () => {
    expect(calledWords('Zap', 2)).toBe('Zap, go to station 2!');
    expect(calledWords('Zap', null)).toBe("Zap, you're up!");
    expect(calledTitle('Zap', 2)).toBe('Zap: go to station 2');
    expect(nextWords('Zap')).toBe("Zap, you're next!");
  });

  it('uses the event name for the page title, or the app name', () => {
    expect(baseTitle('Race Night')).toBe('Race Night');
    expect(baseTitle('  ')).toBe('ColiseumGrid');
    expect(baseTitle(null)).toBe('ColiseumGrid');
  });
});

describe('the cut line', () => {
  const rows = (places: number[]) => places.map((place) => ({ place }));

  it('is above the places that miss the final', () => {
    expect(phoneCutAfter(rows([1, 2, 3, 4, 5, 6]), 4)).toBe(4);
  });

  it('is absent when everyone reaches the final', () => {
    expect(phoneCutAfter(rows([1, 2, 3]), 3)).toBeNull();
  });

  it('moves above a whole tied group that straddles it', () => {
    expect(phoneCutAfter(rows([1, 2, 3, 4, 4, 6]), 4)).toBe(3);
    expect(phoneCutAfter(rows([1, 2, 2, 2, 2, 6]), 4)).toBe(1);
    expect(phoneCutAfter(rows([1, 1, 1, 1, 1, 6]), 4)).toBe(0);
  });
});

describe('standings table', () => {
  it('has wins and losses for a bracket, with no cut', () => {
    const table = standingsTable({
      kind: 'bracket',
      format: 'single',
      finished: false,
      rows: [{ place: 1, player: zap, wins: 3, losses: 0 }],
    });
    expect(table.headings).toEqual(['Wins', 'Losses']);
    expect(table.lines).toEqual([{ playerId: 3, place: 1, handle: 'Zap', first: 3, second: 0 }]);
    expect(table.cutAfter).toBeNull();
  });

  it('has points and groups for groups, with the cut', () => {
    const table = standingsTable(
      heats([
        { place: 1, points: 8, heatsPlayed: 2, id: 1 },
        { place: 2, points: 7, heatsPlayed: 2, id: 2 },
        { place: 3, points: 5, heatsPlayed: 2, id: 3 },
      ], 2),
    );
    expect(table.headings).toEqual(['Points', 'Groups']);
    expect(table.cutAfter).toBe(2);
    expect(table.noResultsYet).toBe(false);
  });

  it('lists players with no places before the first group is played', () => {
    const table = standingsTable(heats([{ place: 1, points: 0, heatsPlayed: 0, id: 1 }, { place: 1, points: 0, heatsPlayed: 0, id: 2 }]));
    expect(table.noResultsYet).toBe(true);
  });
});
