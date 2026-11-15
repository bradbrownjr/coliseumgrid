// The SQLite database, opened with node:sqlite (docs/PLAN.md, section 8). Its schema is
// versioned with PRAGMA user_version: an integer SQLite stores in the file header and leaves
// to the application (https://sqlite.org/pragma.html#pragma_user_version). Version N means
// the first N entries of MIGRATIONS have run.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
// DatabaseSync is the class's earlier name. The Node 26 docs call it a deprecated alias of
// `Database` (DEP0210, documentation-only, https://nodejs.org/docs/latest-v26.x/api/sqlite.html),
// but @types/node 26.6.6 declares only DatabaseSync. Switch when the types follow.
import { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

/**
 * Schema changes, oldest first. Never edit or reorder an entry that has shipped: add a new
 * one. Each runs once, in a transaction, together with the version bump.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE players (
    id         INTEGER PRIMARY KEY,
    handle     TEXT NOT NULL,
    handle_key TEXT NOT NULL UNIQUE,
    pin_hash   TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE events (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  // M3: host sign-in, pairing, and devices (docs/PLAN.md, "Devices and host API"). Times are
  // ISO 8601 UTC text, which sorts and compares correctly as text. Tokens are stored only as
  // SHA-256 hashes (tokens.ts). The current event is the newest row of `events`.
  `
  CREATE TABLE host_settings (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE TABLE host_sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE pairing_codes (
    code       TEXT PRIMARY KEY,
    role       TEXT NOT NULL CHECK (role IN ('display', 'signup')),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT
  );
  CREATE TABLE devices (
    id         INTEGER PRIMARY KEY,
    role       TEXT NOT NULL CHECK (role IN ('display', 'signup')),
    label      TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    last_seen  TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  // M4: brackets (docs/PLAN.md, "Brackets API"). A bracket is stored as its settings, the
  // seeding (a JSON list of player ids and nulls), and three ordered lists, and the server
  // rebuilds everything else by replay. The event has at most one bracket (a new one replaces
  // it), and deleting a bracket removes its lists. The AUTOINCREMENT ids are never reused, so
  // the id of an undone result can't later name a different result. Player ids inside a
  // bracket are plain numbers with no foreign key: merging a player away is refused while they
  // are in a bracket of the current event (players-routes.ts). No handle is stored here.
  // `event_players` is who signed up to the event; it follows a player's deletion.
  `
  CREATE TABLE event_players (
    event_id  INTEGER NOT NULL REFERENCES events(id),
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, player_id)
  );
  CREATE INDEX event_players_player ON event_players (player_id);
  CREATE TABLE brackets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   INTEGER NOT NULL UNIQUE REFERENCES events(id),
    format     TEXT NOT NULL CHECK (format IN ('single', 'double', 'round_robin')),
    best_of    INTEGER NOT NULL CHECK (best_of IN (1, 3, 5)),
    stations   INTEGER NOT NULL CHECK (stations BETWEEN 1 AND 8),
    seeding    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE bracket_results (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
    match_id   INTEGER NOT NULL,
    winner_id  INTEGER NOT NULL,
    loser_id   INTEGER NOT NULL,
    at         TEXT NOT NULL
  );
  CREATE INDEX bracket_results_bracket ON bracket_results (bracket_id, id);
  CREATE TABLE bracket_late_joins (
    bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    player_id  INTEGER NOT NULL,
    step       INTEGER NOT NULL,
    PRIMARY KEY (bracket_id, position)
  );
  CREATE TABLE bracket_tie_breaks (
    bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    round      INTEGER NOT NULL,
    player_a   INTEGER NOT NULL,
    player_b   INTEGER NOT NULL,
    step       INTEGER NOT NULL,
    PRIMARY KEY (bracket_id, position)
  );
  `,
  // M4 review: an older undo leaves the result in the log, marked with the step of the undo
  // and its time (docs/PLAN.md, "Stations and the queue"). Both are null on a result that
  // stands, which is every row written before this migration. A CHECK on an added column is
  // tested against the rows already there (https://sqlite.org/lang_altertable.html).
  `
  ALTER TABLE bracket_results ADD COLUMN undone_at TEXT;
  ALTER TABLE bracket_results ADD COLUMN undone_step INTEGER CHECK ((undone_step IS NULL) = (undone_at IS NULL));
  `,
  // M5: heats (docs/PLAN.md, "Heats API"). Same shape as the bracket tables, with their own
  // columns because `brackets` and `bracket_results` can't be altered to fit (SQLite's ALTER
  // TABLE can't change a CHECK or drop NOT NULL). A run is its settings, the points table and
  // the seeding as JSON, and three ordered lists; the server rebuilds the rest by replay. The
  // event has at most one run, and deleting a run removes its lists. AUTOINCREMENT ids are never
  // reused, so an undone result's id can't later name another result. Player ids inside a run
  // are plain numbers with no foreign key: merging a player away is refused while they are in
  // the current event's heats (players-routes.ts). No handle is stored. `finish_order` is the
  // JSON list of player ids, 1st first. An older undo keeps its result's row with the step and
  // time of the undo, both or neither.
  `
  CREATE TABLE heat_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   INTEGER NOT NULL UNIQUE REFERENCES events(id),
    stations   INTEGER NOT NULL CHECK (stations BETWEEN 1 AND 8),
    races      INTEGER NOT NULL CHECK (races BETWEEN 1 AND 4),
    rounds     INTEGER NOT NULL CHECK (rounds BETWEEN 0 AND 3),
    points     TEXT NOT NULL,
    seeding    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE heat_results (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id       INTEGER NOT NULL REFERENCES heat_runs(id) ON DELETE CASCADE,
    heat_id      INTEGER NOT NULL,
    finish_order TEXT NOT NULL,
    at           TEXT NOT NULL,
    undone_step  INTEGER,
    undone_at    TEXT,
    CHECK ((undone_step IS NULL) = (undone_at IS NULL))
  );
  CREATE INDEX heat_results_run ON heat_results (run_id, id);
  CREATE TABLE heat_late_joins (
    run_id    INTEGER NOT NULL REFERENCES heat_runs(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    heat_id   INTEGER NOT NULL,
    step      INTEGER NOT NULL,
    PRIMARY KEY (run_id, position)
  );
  CREATE TABLE heat_tie_breaks (
    run_id   INTEGER NOT NULL REFERENCES heat_runs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    players  TEXT NOT NULL,
    step     INTEGER NOT NULL,
    PRIMARY KEY (run_id, position)
  );
  `,
  // M6: phones (docs/PLAN.md, "Player view" and "Phone API"). A phone is not a device: it signs
  // itself in, so it has its own table and cookie. Every table is new and only points at
  // `players`, so a database from M2 to M5 migrates untouched. A phone's token is stored only as
  // a SHA-256 hash. `phone_follows` and `follow_codes` go with the player (a merge moves the
  // follows first, players-routes.ts); `push_subscriptions` goes with the phone. No handle is
  // stored: an answer joins the current one. The VAPID keys are a file in DATA_DIR, not a table
  // (vapid-keys.ts), and the VAPID subject is a setting, so neither is stored here.
  `
  CREATE TABLE phones (
    id         INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    last_seen  TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE phone_follows (
    phone_id   INTEGER NOT NULL REFERENCES phones(id) ON DELETE CASCADE,
    player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (phone_id, player_id)
  );
  CREATE INDEX phone_follows_player ON phone_follows (player_id);
  CREATE TABLE follow_codes (
    code       TEXT PRIMARY KEY,
    player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT
  );
  CREATE INDEX follow_codes_player ON follow_codes (player_id);
  CREATE TABLE push_subscriptions (
    phone_id   INTEGER PRIMARY KEY REFERENCES phones(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  // M7: the setup wizard, new events, and no-shows (docs/PLAN.md, "The setup wizard" and
  // "Waiting for a missing player"). `events.game` is the host's typed game name, null for none;
  // `events.plan` is the plan as JSON, read back through `isEventPlan` so an unreadable one is
  // as good as none. `bracket_results.forfeit` is 1 when the winner won because the other
  // player didn't come; `heat_results.missing` is a JSON list of the player ids who didn't
  // come, null for none. Every column is added with a default, so rows from M2 to M6 migrate
  // as they were. Ids only, no handle (CLAUDE.md, rule 1).
  `
  ALTER TABLE events ADD COLUMN game TEXT;
  ALTER TABLE events ADD COLUMN plan TEXT;
  ALTER TABLE bracket_results ADD COLUMN forfeit INTEGER NOT NULL DEFAULT 0 CHECK (forfeit IN (0, 1));
  ALTER TABLE heat_results ADD COLUMN missing TEXT;
  `,
  // M7 review: a tie-break's own start time, and "They're here" (docs/PLAN.md, "Waiting for a
  // missing player"). `at` is when the host pressed Play tie-break, null on a row from before
  // this migration, which is then called at the last result's time as it was. An arrival is the
  // match (or heat) and the `called_at` of the call it was tapped for, so a match called again
  // starts a new wait; it is not a result, so no log, standing, or undo reads it. Ids and times
  // only (CLAUDE.md, rule 1).
  `
  ALTER TABLE bracket_tie_breaks ADD COLUMN at TEXT;
  ALTER TABLE heat_tie_breaks ADD COLUMN at TEXT;
  CREATE TABLE bracket_arrivals (
    bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
    match_id   INTEGER NOT NULL,
    called_at  TEXT NOT NULL,
    PRIMARY KEY (bracket_id, match_id, called_at)
  );
  CREATE TABLE heat_arrivals (
    run_id    INTEGER NOT NULL REFERENCES heat_runs(id) ON DELETE CASCADE,
    heat_id   INTEGER NOT NULL,
    called_at TEXT NOT NULL,
    PRIMARY KEY (run_id, heat_id, called_at)
  );
  `,
];

export function migrate(db: Database): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  const current = row.user_version;
  if (current > MIGRATIONS.length) {
    throw new Error(`The database is at schema version ${current}, newer than this server's ${MIGRATIONS.length}.`);
  }
  for (let version = current + 1; version <= MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version - 1] as string);
      // PRAGMA takes no bound parameters; `version` is our own integer.
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** How many `inTransaction` calls are open, for naming a savepoint. The work is synchronous, so one counter is enough. */
let savepointDepth = 0;

/**
 * Runs `work` in one transaction: all its writes happen, or none do. Inside another
 * transaction it is a savepoint (https://sqlite.org/lang_savepoint.html), so a store's save can
 * be one step of a larger change that is also all or nothing.
 */
export function inTransaction<T>(db: Database, work: () => T): T {
  const nested = db.isTransaction;
  // A savepoint's name only has to differ from the ones it sits inside.
  const name = `nested_${savepointDepth}`;
  db.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN');
  savepointDepth += 1;
  try {
    const result = work();
    db.exec(nested ? `RELEASE ${name}` : 'COMMIT');
    return result;
  } catch (error) {
    db.exec(nested ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK');
    throw error;
  } finally {
    savepointDepth -= 1;
  }
}


/**
 * Opens the database at `file`, creating its folder, and brings the schema up to date.
 * ':memory:' (https://nodejs.org/docs/latest-v26.x/api/sqlite.html) gives a private database
 * that vanishes on close, for tests.
 */
export function openDatabase(file: string): Database {
  const inMemory = file === ':memory:';
  if (!inMemory) mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // Write-ahead logging lets a read run during a write and survives a power cut mid-write
  // (https://sqlite.org/wal.html). It needs a file, so an in-memory database skips it.
  if (!inMemory) db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  return db;
}
