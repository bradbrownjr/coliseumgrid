// The players API's request and answer shapes (docs/PLAN.md, "Players API"), shared so the
// server and the client can't drift apart. Types only: nothing here runs.

import type { EventPlan } from './event-plan.ts';
import type { HandleRefusal } from './handle.ts';

/** The only player fields that leave the server (CLAUDE.md, rule 1). */
export interface Player {
  id: number;
  handle: string;
}

export type ApiErrorCode =
  | 'refused'
  | 'taken'
  | 'bad-pin'
  | 'wrong-pin'
  | 'not-found'
  | 'too-many-tries'
  | 'bad-request'
  | 'server-error'
  | 'not-signed-in'
  | 'forbidden'
  | 'wrong-password'
  | 'wrong-code'
  | 'not-paired'
  | 'bracket-running'
  | 'too-few-players'
  | 'too-many-players'
  | 'not-on-station'
  | 'undo-later-first'
  | 'nothing-to-undo'
  | 'late-closed'
  | 'already-in'
  | 'in-bracket'
  | 'no-tie'
  | 'no-bracket'
  | 'no-heats'
  | 'not-following'
  | 'too-many-handles'
  | 'push-off'
  | 'bad-image'
  | 'too-large'
  | 'bad-type';

export type ApiError =
  | { error: 'refused'; reason: HandleRefusal }
  | { error: Exclude<ApiErrorCode, 'refused'> };

export interface HandleBody {
  handle: string;
}

export interface HandlePinBody {
  handle: string;
  pin: string;
}

export interface MergeBody {
  intoId: number;
}

/** POST /api/signup/check */
export type SignupCheckAnswer =
  | { status: 'available'; handle: string; suggestedPin: string }
  | { status: 'taken'; handle: string };

/** POST /api/signup and POST /api/signup/claim; PATCH /api/players/:id; POST .../merge */
export interface PlayerAnswer {
  player: Player;
}

/** GET /api/players */
export interface PlayersAnswer {
  players: Player[];
}

/** POST /api/players */
export interface NewPlayerAnswer {
  player: Player;
  pin: string;
}

/** POST /api/players/:id/reset-pin */
export interface PinAnswer {
  pin: string;
}

// Devices and host API (docs/PLAN.md, "Devices and host API"), from M3.

export type DeviceRole = 'display' | 'signup';

/** The only device fields that leave the server. `lastSeen` is an ISO 8601 time. */
export interface Device {
  id: number;
  role: DeviceRole;
  label: string;
  lastSeen: string;
}

export interface EventInfo {
  name: string;
  /** What the event plays, as the host typed it (M7); null when left empty. Event data, never code. */
  game: string | null;
  /** The event's picture for the tags and the TV (M8), or null for none. */
  graphic: EventGraphic | null;
}

/**
 * The event graphic's size in pixels, read from its header, and `version`, an opaque string
 * that changes with each upload, so a page knows to load `GET /api/event/graphic` again.
 */
export interface EventGraphic {
  width: number;
  height: number;
  version: string;
}

/** GET /api/host/session */
export interface HostSessionAnswer {
  signedIn: boolean;
  passwordSet: boolean;
  canSetUp: boolean;
}

/** POST /api/host/setup and POST /api/host/sign-in */
export interface PasswordBody {
  password: string;
}

/** POST /api/pairing/codes */
export interface PairingCodeBody {
  role: DeviceRole;
}

/** POST /api/pairing/codes. `code` is the canonical 6 characters; `expiresAt` is ISO 8601. */
export interface PairingCodeAnswer {
  code: string;
  role: DeviceRole;
  expiresAt: string;
}

/** POST /api/devices/join */
export interface JoinBody {
  code: string;
}

/** POST /api/devices/join and GET /api/devices/me */
export interface DeviceAnswer {
  device: Device;
}

/** GET /api/devices */
export interface DevicesAnswer {
  devices: Device[];
}

/** GET and PUT /api/event */
export interface EventAnswer {
  event: EventInfo | null;
}

/** PUT /api/event and POST /api/events. On PUT, a `game` left out keeps the stored one and an empty string clears it. */
export interface EventBody {
  name: string;
  game?: string;
}

/** POST /api/events (M7): 201, the new current event. */
export interface NewEventAnswer {
  event: EventInfo;
}

// The event's plan (docs/PLAN.md, "The setup wizard"), from M7. Host only.

/** GET /api/event/plan: null when the event has no plan or its plan can't be read. */
export interface PlanAnswer {
  plan: EventPlan | null;
}

/** PUT /api/event/plan: the server answers 400 `bad-request` unless `isEventPlan` accepts it. */
export interface PlanBody {
  plan: EventPlan;
}

/** PUT /api/event/plan */
export interface PlanNowAnswer {
  plan: EventPlan;
}

// Name tags (docs/PLAN.md, "Name tags API"), from M8. Host only, except the graphic itself.

/**
 * A tag waiting to print. `pin` is the plain PIN, held only until the tag prints or for 12
 * hours, whichever is first; null for a reprint or once it was wiped.
 */
export interface NameTag {
  playerId: number;
  handle: string;
  pin: string | null;
}

/** GET /api/tags: sorted by handle. */
export interface TagsAnswer {
  tags: NameTag[];
}

/** POST /api/tags: a reprint of one player's tag. */
export interface TagBody {
  playerId: number;
}

/** POST /api/tags: 201, the queued reprint, with no PIN. */
export interface TagAnswer {
  tag: NameTag;
}

/** POST /api/tags/printed: those tags and their PINs are deleted. */
export interface TagsPrintedBody {
  playerIds: number[];
}

/** Messages the server sends on GET /api/live. */
export type LiveMessage =
  | { type: 'event'; event: EventInfo | null }
  | { type: 'players' }
  | { type: 'bracket' }
  | { type: 'heats' }
  /** The event's plan changed (PUT /api/event/plan, POST /api/events). No payload: a host window reads the plan again. */
  | { type: 'plan' }
  /** The print queue changed (M8). No payload, and only host screens get it: a host page reads GET /api/tags again. */
  | { type: 'tags' }
  | { type: 'unpaired' };

// Brackets API (docs/PLAN.md, "Brackets API"), from M4. A player is always `Player`, so no
// answer carries more than an id and a handle (CLAUDE.md, rule 1).

/** Stored and sent as these words; the screens say "One life", "Two lives", and so on. */
export type BracketFormat = 'single' | 'double' | 'round_robin';

/** A label for the host. One tap records a match, whatever this says. */
export type BestOf = 1 | 3 | 5;

/**
 * Where a match sits. `main` is single elimination and round robin; `winners` and `losers`
 * are the two halves of two lives; `final` and `rematch` are its grand final and the
 * rematch for the title; `third` is single elimination's 3rd-place match; `tie-break` is a
 * match played to settle a tie for places 1 to 3 (docs/PLAN.md, "Ties").
 */
export type MatchSide = 'main' | 'winners' | 'losers' | 'final' | 'rematch' | 'third' | 'tie-break';

/**
 * `waiting`: a player is not known yet. `ready`: both are known and the match is in the
 * queue. `playing`: it is on a station. `done`: it has a result. `bye`: one side is empty.
 */
export type MatchStatus = 'waiting' | 'ready' | 'playing' | 'done' | 'bye';

/** `player` is null while the slot is waiting or empty; `bye` is true for an empty slot. */
export interface BracketSlot {
  player: Player | null;
  bye: boolean;
}

export interface BracketMatch {
  id: number;
  side: MatchSide;
  /** Starts at 1 within a side. For `tie-break` it counts the tie-break rounds. */
  round: number;
  /** Starts at 1 within a round. */
  number: number;
  status: MatchStatus;
  slots: [BracketSlot, BracketSlot];
  /** Index of the winning slot, or null before a result. */
  winner: 0 | 1 | null;
  /** M7: the winner won because the other player didn't come (docs/PLAN.md, "Waiting for a missing player"). */
  forfeit: boolean;
  /** The result to undo; null until the match is done. */
  resultId: number | null;
}

/**
 * `calledAt` is an ISO 8601 time; the TV's timer counts up from it. `arrived` is true once the
 * host tapped **They're here** for this call of the match (docs/PLAN.md, "Waiting for a missing
 * player"): the prompt and the TV's call line are gone. A match called again after an undo is a
 * new call, so it starts with `arrived` false.
 */
export interface BracketStation {
  number: number;
  match: BracketMatch | null;
  calledAt: string | null;
  arrived: boolean;
}

/** Players who tie share a `place`. Places 1 to 3 are never shared once the bracket is finished. */
export interface StandingsRow {
  place: number;
  player: Player;
  wins: number;
  losses: number;
}

/** A tie for `place` that has to be played off. `started` is true while its matches exist. */
export interface TieNotice {
  place: number;
  players: Player[];
  started: boolean;
}

export interface Bracket {
  id: number;
  format: BracketFormat;
  bestOf: BestOf;
  finished: boolean;
  /** True while the host can still add a player. */
  lateOpen: boolean;
  lastResultId: number | null;
  /** M7: minutes after `calledAt` when a station's wait is over; 5 when the event has no plan. */
  noShowMinutes: number;
  stations: BracketStation[];
  upNext: BracketMatch[];
  matches: BracketMatch[];
  standings: StandingsRow[];
  ties: TieNotice[];
}

/**
 * GET /api/bracket. `now` is the server's clock as an ISO 8601 time, sent with every answer
 * that carries the bracket, so a screen with a clock of its own can time `calledAt` against the
 * server's (docs/PLAN.md, "Waiting for a missing player").
 */
export interface BracketAnswer {
  bracket: Bracket | null;
  now: string;
}

/**
 * POST /api/bracket, POST /api/bracket/undo, POST /api/bracket/players, POST
 * /api/bracket/tie-break, POST /api/bracket/arrived
 */
export interface BracketNowAnswer {
  bracket: Bracket;
  now: string;
}

/** POST /api/bracket */
export interface NewBracketBody {
  format: BracketFormat;
  bestOf: BestOf;
  /** 1 to 8, fixed for the life of the bracket. */
  stations: number;
  playerIds: number[];
}

/** POST /api/bracket/results */
export interface BracketResultBody {
  matchId: number;
  winnerId: number;
  /** M7: true when `winnerId` is the player who came and the other didn't. False when left out. */
  forfeit?: boolean;
}

/** POST /api/bracket/results */
export interface BracketResultAnswer {
  bracket: Bracket;
  resultId: number;
  now: string;
}

/**
 * POST /api/bracket/arrived: `arrived` true is **They're here** for the match's current call,
 * false takes it back. The match has to be on a station (409 `not-on-station`).
 */
export interface BracketArrivedBody {
  matchId: number;
  arrived: boolean;
}

/** POST /api/bracket/undo */
export interface BracketUndoBody {
  resultId: number;
}

/** POST /api/bracket/players */
export interface BracketPlayerBody {
  playerId: number;
}

/** GET /api/event/players: the players signed up to the current event. */
export interface EventPlayersAnswer {
  playerIds: number[];
}

// Heats API (docs/PLAN.md, "Heats API"), from M5. On screen a heat is a "Group"
// (docs/DOC-STYLE.md); the code and the API say heat.

/** A label for the host, like `BestOf`. One tap sequence records a whole heat. */
export type RacesPerHeat = 1 | 2 | 3 | 4;

/** `round`: a qualifying round. `tie-break`: a race at the cut for the final. `final`: the final. */
export type HeatKind = 'round' | 'tie-break' | 'final';

/** `ready`: in the queue. `playing`: on a station. `done`: it has a finishing order. */
export type HeatStatus = 'ready' | 'playing' | 'done';

export interface Heat {
  id: number;
  kind: HeatKind;
  /** The qualifying round from 1; for `tie-break` the pass from 1; 1 for the final. */
  round: number;
  /** From 1 within its round or pass. */
  number: number;
  status: HeatStatus;
  /** 2 to 4, in the order they were grouped. */
  players: Player[];
  /** The finishing order once recorded, 1st first. */
  order: Player[] | null;
  /** M7: players who didn't come, empty when none and before a result. They score 0 points. */
  missing: Player[];
  /** The result to undo; null until the heat is done. */
  resultId: number | null;
}

/** `calledAt` and `arrived` are as for `BracketStation`. */
export interface HeatStation {
  number: number;
  heat: Heat | null;
  calledAt: string | null;
  arrived: boolean;
}

/** Players level on points share a `place`. Places 1 to 3 are never shared once the final is done. */
export interface HeatStandingsRow {
  place: number;
  player: Player;
  /** Qualifying points; tie-break heats and the final score nothing. */
  points: number;
  /** Qualifying heats played. */
  heatsPlayed: number;
}

export interface Heats {
  id: number;
  races: RacesPerHeat;
  /** Qualifying rounds, 1 to 3; 0 when 2 to 4 players play only the final. */
  rounds: number;
  /** Points for 1st to 4th. */
  points: number[];
  /** The final has a result and no tie is waiting. */
  finished: boolean;
  /** True while the host can still add a player. */
  lateOpen: boolean;
  lastResultId: number | null;
  /** M7: minutes after `calledAt` when a station's wait is over; 5 when the event has no plan. */
  noShowMinutes: number;
  /** The qualifying round being played; null once qualifying is over (tie-breaks and the final). */
  round: number | null;
  stations: HeatStation[];
  upNext: Heat[];
  /** Every heat made so far, in the order made. Later rounds appear when the one before is done. */
  heats: Heat[];
  standings: HeatStandingsRow[];
  /** Places 1 to `finalSize` reach the final: 4, or every player when there are 2 to 4. */
  finalSize: number;
  /** A tie across the cut for the final that isn't settled. */
  ties: TieNotice[];
}

/** GET /api/heats. `now` is the server's clock, as for `BracketAnswer`. */
export interface HeatsAnswer {
  heats: Heats | null;
  now: string;
}

/** POST /api/heats, POST /api/heats/undo, POST /api/heats/players, POST /api/heats/tie-break, POST /api/heats/arrived */
export interface HeatsNowAnswer {
  heats: Heats;
  now: string;
}

/** POST /api/heats */
export interface NewHeatsBody {
  /** 1 to 8, fixed for the life of the heats. */
  stations: number;
  races: RacesPerHeat;
  /** 1 to 3. Ignored, and stored as 0, with 2 to 4 players. */
  rounds: number;
  /** 4 whole numbers from 0 to 20, never rising, 1st at least 1 (`isPointsTable`). */
  points: number[];
  playerIds: number[];
}

/** POST /api/heats/results */
export interface HeatResultBody {
  heatId: number;
  /** The players who played, 1st first. With no `missing`, every player of the heat once. At least one. */
  order: number[];
  /** M7: the players who didn't come. `order` and `missing` together are the heat's players, each once. Empty when left out. */
  missing?: number[];
}

/** POST /api/heats/results */
export interface HeatResultAnswer {
  heats: Heats;
  resultId: number;
  now: string;
}

/** POST /api/heats/arrived: as `BracketArrivedBody`, for the group on a station. */
export interface HeatArrivedBody {
  heatId: number;
  arrived: boolean;
}

/** POST /api/heats/undo */
export interface HeatUndoBody {
  resultId: number;
}

/** POST /api/heats/players */
export interface HeatPlayerBody {
  playerId: number;
}

// Phone API (docs/PLAN.md, "Phone API"), from M6. A phone isn't a device: it follows players
// by handle and PIN, and gets one narrow answer instead of the bracket or the heats. A player
// is still only `Player` (CLAUDE.md, rule 1).

/**
 * Where a followed player stands. `now`: on a station. `next`, `two-away`, `later`: waiting in
 * Up next, first, second, or further back. `waiting`: in a match or group that isn't ready
 * (the other player isn't known, or the next round isn't made), or tied and waiting for a
 * tie-break. `out`: no match left while the event goes on. `done`: the event is finished.
 * `not-in`: not in the bracket or groups.
 */
export type FollowStatus = 'now' | 'next' | 'two-away' | 'later' | 'waiting' | 'out' | 'done' | 'not-in';

/** What `playerStatus` works out for one player (`packages/core/src/player-status.ts`). */
export interface PlayerStatus {
  status: FollowStatus;
  /** 0 on a station; 1 first in Up next, 2 second, and so on; null otherwise. */
  away: number | null;
  /** The station number while `status` is `now`; null otherwise. */
  station: number | null;
  /** The match or group id for `now`, `next`, `two-away`, `later`, and `waiting` in a known match; null otherwise. */
  matchId: number | null;
  /** The other players of that match or group who are known; empty when `matchId` is null. */
  others: Player[];
  /** The final place, only with `done`. */
  place: number | null;
}

/** A player a phone follows, with where they stand. */
export interface FollowedPlayer extends PlayerStatus {
  player: Player;
}

/** The phone's standings: the same rows as the Display, with what the page needs to word them. */
export type PhoneStandings =
  | { kind: 'bracket'; format: BracketFormat; finished: boolean; rows: StandingsRow[] }
  | { kind: 'heats'; finished: boolean; rows: HeatStandingsRow[]; finalSize: number };

/** GET /api/phone */
export interface PhoneAnswer {
  event: EventInfo | null;
  following: FollowedPlayer[];
  /** Null while the event has no bracket or groups. */
  standings: PhoneStandings | null;
}

/** POST /api/phone/follow takes `HandlePinBody`. */

/** POST /api/phone/follow-code */
export interface FollowCodeBody {
  /** The canonical 6 characters, as for `JoinBody`. */
  code: string;
}

/** A code a phone scans to follow one player. Works once and expires after 10 minutes; `expiresAt` is ISO 8601. */
export interface FollowCode {
  code: string;
  expiresAt: string;
}

/**
 * POST /api/signup and POST /api/signup/claim. The code is made only after the PIN was set or
 * proven, so a Sign-up tablet can't make one for any player.
 */
export interface SignupAnswer extends PlayerAnswer {
  followCode: FollowCode;
}

/** POST /api/phone/follow, POST /api/phone/follow-code, DELETE /api/phone/follow/:playerId */
export interface PhoneFollowingAnswer {
  following: Player[];
}

/** GET /api/phone/push: `publicKey` is the VAPID key, or null offline and over plain HTTP. */
export interface PhonePushKeyAnswer {
  publicKey: string | null;
}

/** PUT /api/phone/push: a browser push subscription as `PushSubscription.toJSON()` gives it. */
export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
