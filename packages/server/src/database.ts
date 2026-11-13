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

/** Runs `work` in one transaction: all its writes happen, or none do. */
export function inTransaction<T>(db: Database, work: () => T): T {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
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
