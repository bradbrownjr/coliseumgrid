// What the player page says (docs/PLAN.md, "Player view"). Pure functions of a followed
// player and the standings, with no React, so the words are tested without a screen. The
// wording follows docs/DOC-STYLE.md: short, plain, and a "group" where the host says "heat".

import type { FollowedPlayer, HeatStandingsRow, PhoneStandings, StandingsRow } from '@coliseumgrid/core';
import { cutAfter } from '../../heatsWords.ts';
import { joinHandles } from '../../handles.ts';
import { ordinal } from '../display/model.ts';

/** The word for one entry of Up next: a bracket has matches, groups have groups. */
export type Unit = 'match' | 'group';

export const unitOf = (standings: PhoneStandings | null): Unit => (standings?.kind === 'heats' ? 'group' : 'match');

/** A round robin has nobody knocked out: "out" there means every match is played. */
const isRoundRobin = (standings: PhoneStandings | null): boolean =>
  standings?.kind === 'bracket' && standings.format === 'round_robin';

/** "Zap, go to station 2!", the line on the full-screen alert. */
export function calledWords(handle: string, station: number | null): string {
  return station === null ? `${handle}, you're up!` : `${handle}, go to station ${station}!`;
}

/** The page title while a call is waiting. */
export function calledTitle(handle: string, station: number | null): string {
  return station === null ? `${handle}: you're up` : `${handle}: go to station ${station}`;
}

/** "Zap, you're next!", the line on the banner. */
export const nextWords = (handle: string): string => `${handle}, you're next!`;

const plural = (unit: Unit): string => (unit === 'match' ? 'matches' : 'groups');

/**
 * The status in plain words, as the big line on a player's card. "Away" counts entries of Up
 * next, and the queue can skip one when it fills a station, so a number past two says "about"
 * (docs/PLAN.md, "Player view").
 */
export function statusWords(followed: FollowedPlayer, standings: PhoneStandings | null): string {
  const unit = unitOf(standings);
  switch (followed.status) {
    case 'now':
      return followed.station === null ? "You're up!" : `You're up! Go to station ${followed.station}`;
    case 'next':
      return "You're next";
    case 'two-away':
      return `Two ${plural(unit)} away`;
    case 'later': {
      const away = followed.away ?? 3;
      return `About ${away} ${plural(unit)} away`;
    }
    case 'waiting':
      return `Waiting for your next ${unit}`;
    case 'out':
      return isRoundRobin(standings) ? 'All your matches are played. Thanks for playing!' : "You're out. Thanks for playing!";
    case 'done':
      if (followed.place === null) return 'The event is over. Thanks for playing!';
      return followed.place === 1 ? 'You won! Finished 1st' : `Finished ${ordinal(followed.place)}`;
    case 'not-in':
      return standings === null ? "The host hasn't started yet" : "You're not playing in this one";
  }
}

/**
 * Who else is in the match or group, or null when nobody is known. A match is one opponent
 * ("Against Kai"); a group is the others ("With Kai, Blaze, and Jett").
 */
export function othersWords(followed: Pick<FollowedPlayer, 'others'>, standings: PhoneStandings | null): string | null {
  if (followed.others.length === 0) return null;
  return `${unitOf(standings) === 'match' ? 'Against' : 'With'} ${joinHandles(followed.others)}`;
}

/** Words for the heading over the standings. */
export const standingsHeading = (finished: boolean): string => (finished ? 'Final standings' : 'Standings');

/** A row of the standings as the page draws it: two numbers and a place. */
export interface PhoneLine {
  playerId: number;
  place: number;
  handle: string;
  first: number;
  second: number;
}

export interface PhoneTable {
  headings: [string, string];
  lines: PhoneLine[];
  /** The row count above the cut line, or null for no line. */
  cutAfter: number | null;
  /** Players with no result yet: the page lists handles with no places. */
  noResultsYet: boolean;
}

const bracketLine = (row: StandingsRow): PhoneLine => ({
  playerId: row.player.id,
  place: row.place,
  handle: row.player.handle,
  first: row.wins,
  second: row.losses,
});

const heatLine = (row: HeatStandingsRow): PhoneLine => ({
  playerId: row.player.id,
  place: row.place,
  handle: row.player.handle,
  first: row.points,
  second: row.heatsPlayed,
});

/**
 * Where the cut line goes. Like the Display's line it moves above a whole tied group, so only
 * the rows above it are surely through. The phone's answer has no list of open ties, so a tie
 * is read from rows that share a place across the cut.
 */
export function phoneCutAfter(rows: readonly { place: number }[], finalSize: number): number | null {
  const after = cutAfter(rows.length, finalSize);
  if (after === null) return null;
  const last = rows[after - 1];
  const first = rows[after];
  if (!last || !first || last.place !== first.place) return after;
  return rows.findIndex((row) => row.place === last.place);
}

/** The standings as the page draws them. */
export function standingsTable(standings: PhoneStandings): PhoneTable {
  if (standings.kind === 'bracket') {
    return { headings: ['Wins', 'Losses'], lines: standings.rows.map(bracketLine), cutAfter: null, noResultsYet: false };
  }
  return {
    headings: ['Points', 'Groups'],
    lines: standings.rows.map(heatLine),
    cutAfter: phoneCutAfter(standings.rows, standings.finalSize),
    // Before any qualifying group has a result, every player is level: places would mislead.
    noResultsYet: standings.rows.length > 0 && standings.rows.every((row) => row.heatsPlayed === 0),
  };
}

/** The tab title with no alert up: the event's name, or the app's. */
export const baseTitle = (eventName: string | null | undefined): string => eventName?.trim() || 'ColiseumGrid';
