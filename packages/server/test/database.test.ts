import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate, openDatabase } from '../src/database.ts';

const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const columns = (db: DatabaseSync, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('migrations', () => {
  it('bring a new database to the latest version with the players and events tables', () => {
    const db = openDatabase(':memory:');
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(columns(db, 'players')).toEqual(['id', 'handle', 'handle_key', 'pin_hash', 'created_at']);
    expect(columns(db, 'events')).toEqual(['id', 'name', 'created_at']);
  });

  it('add the host, pairing, and device tables, with no token or password stored in plain text', () => {
    const db = openDatabase(':memory:');
    expect(columns(db, 'host_settings')).toEqual(['id', 'password_hash', 'updated_at']);
    expect(columns(db, 'host_sessions')).toEqual(['token_hash', 'created_at', 'expires_at']);
    expect(columns(db, 'pairing_codes')).toEqual(['code', 'role', 'created_at', 'expires_at', 'used_at']);
    expect(columns(db, 'devices')).toEqual(['id', 'role', 'label', 'token_hash', 'last_seen', 'created_at']);
  });

  it('allow one host password row, and only the two device roles', () => {
    const db = openDatabase(':memory:');
    const insertPassword = db.prepare("INSERT INTO host_settings (id, password_hash, updated_at) VALUES (?, 'h', 't')");
    insertPassword.run(1);
    expect(() => insertPassword.run(1)).toThrow(/UNIQUE|PRIMARY/);
    expect(() => insertPassword.run(2)).toThrow(/CHECK/);
    expect(() =>
      db.prepare("INSERT INTO pairing_codes (code, role, created_at, expires_at) VALUES ('AAAAAA', 'host', 't', 't')").run(),
    ).toThrow(/CHECK/);
  });

  it('keep device token hashes unique', () => {
    const db = openDatabase(':memory:');
    const insert = db.prepare(
      "INSERT INTO devices (role, label, token_hash, last_seen, created_at) VALUES ('display', 'Display 1', ?, 't', 't')",
    );
    insert.run('abc');
    expect(() => insert.run('abc')).toThrow(/UNIQUE/);
  });

  it('run once: running again changes nothing and keeps the rows', () => {
    const db = openDatabase(':memory:');
    db.prepare("INSERT INTO players (handle, handle_key, pin_hash, created_at) VALUES ('Zap', 'zap', 'h', 't')").run();
    migrate(db);
    migrate(db);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(db.prepare('SELECT COUNT(*) AS n FROM players').get()).toEqual({ n: 1 });
  });

  it('refuse a database from a newer server', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(db)).toThrow(/newer/);
  });

  it('roll back a failing step and leave the version alone', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const before = version(db);
    // The second statement fails (the table exists), so the first must not survive.
    const steps = MIGRATIONS as string[];
    steps.push('CREATE TABLE ok_table (a); CREATE TABLE players (a);');
    try {
      expect(() => migrate(db)).toThrow();
      expect(version(db)).toBe(before);
      expect(() => db.prepare('SELECT * FROM ok_table')).toThrow();
    } finally {
      steps.pop();
    }
  });

  it('keep handle_key unique', () => {
    const db = openDatabase(':memory:');
    const insert = db.prepare("INSERT INTO players (handle, handle_key, pin_hash, created_at) VALUES (?, ?, 'h', 't')");
    insert.run('Zap', 'zap');
    expect(() => insert.run('ZAP', 'zap')).toThrow(/UNIQUE/);
  });
});

describe('migration 3 (brackets)', () => {
  /** A database as M3 left it: schema version 2, with a player, an event, a host, and a device. */
  function oldDatabase(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS[0] as string);
    db.exec(MIGRATIONS[1] as string);
    db.exec('PRAGMA user_version = 2');
    db.exec(`
      INSERT INTO players (handle, handle_key, pin_hash, created_at) VALUES ('Zap', 'zap', 'h1', 't1'), ('Bolt', 'bolt', 'h2', 't2');
      INSERT INTO events (name, created_at) VALUES ('Friday', 't3');
      INSERT INTO host_settings (id, password_hash, updated_at) VALUES (1, 'ph', 't4');
      INSERT INTO host_sessions (token_hash, created_at, expires_at) VALUES ('s1', 't5', 't6');
      INSERT INTO pairing_codes (code, role, created_at, expires_at) VALUES ('ABCDEF', 'display', 't7', 't8');
      INSERT INTO devices (role, label, token_hash, last_seen, created_at) VALUES ('signup', 'Sign-up 1', 'd1', 't9', 't10');
    `);
    return db;
  }

  const dump = (db: DatabaseSync, table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all();
  const OLD_TABLES = ['players', 'events', 'host_settings', 'host_sessions', 'pairing_codes', 'devices'];

  it('adds the bracket tables to a database that has M2 and M3 data, and keeps every old row', () => {
    const db = oldDatabase();
    const before = OLD_TABLES.map((t) => dump(db, t));
    migrate(db);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(OLD_TABLES.map((t) => dump(db, t))).toEqual(before);
    expect(columns(db, 'brackets')).toEqual(['id', 'event_id', 'format', 'best_of', 'stations', 'seeding', 'created_at']);
    // undone_at and undone_step are migration 4's.
    expect(columns(db, 'bracket_results')).toEqual(['id', 'bracket_id', 'match_id', 'winner_id', 'loser_id', 'at', 'undone_at', 'undone_step']);
    expect(columns(db, 'bracket_late_joins')).toEqual(['bracket_id', 'position', 'player_id', 'step']);
    expect(columns(db, 'bracket_tie_breaks')).toEqual(['bracket_id', 'position', 'round', 'player_a', 'player_b', 'step']);
    expect(columns(db, 'event_players')).toEqual(['event_id', 'player_id']);
    for (const table of ['brackets', 'bracket_results', 'bracket_late_joins', 'bracket_tie_breaks', 'event_players']) {
      expect(dump(db, table), table).toEqual([]);
    }
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });

  it('also upgrades a database that is still at M2', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS[0] as string);
    db.exec('PRAGMA user_version = 1');
    db.exec("INSERT INTO players (handle, handle_key, pin_hash, created_at) VALUES ('Zap', 'zap', 'h1', 't1')");
    migrate(db);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(db.prepare('SELECT handle FROM players').all()).toEqual([{ handle: 'Zap' }]);
  });

  it('lets the old data be used with the new tables', () => {
    const db = oldDatabase();
    migrate(db);
    db.exec("INSERT INTO event_players (event_id, player_id) VALUES (1, 1), (1, 2)");
    db.exec("INSERT INTO brackets (event_id, format, best_of, stations, seeding, created_at) VALUES (1, 'single', 1, 2, '[1,2]', 't')");
    db.exec("INSERT INTO bracket_results (bracket_id, match_id, winner_id, loser_id, at) VALUES (1, 0, 1, 2, 't')");
    expect(db.prepare('SELECT COUNT(*) AS n FROM event_players').get()).toEqual({ n: 2 });
  });

  it('keeps a player in an event once, follows a deleted player, and rejects an unknown player or event', () => {
    const db = openDatabase(':memory:');
    db.exec("INSERT INTO players (handle, handle_key, pin_hash, created_at) VALUES ('Zap', 'zap', 'h', 't')");
    db.exec("INSERT INTO events (name, created_at) VALUES ('Friday', 't')");
    const add = db.prepare('INSERT INTO event_players (event_id, player_id) VALUES (?, ?)');
    add.run(1, 1);
    expect(() => add.run(1, 1)).toThrow(/UNIQUE|PRIMARY/);
    expect(() => add.run(1, 99)).toThrow(/FOREIGN/);
    expect(() => add.run(99, 1)).toThrow(/FOREIGN/);
    db.exec('DELETE FROM players WHERE id = 1');
    expect(db.prepare('SELECT COUNT(*) AS n FROM event_players').get()).toEqual({ n: 0 });
  });

  it('allows one bracket per event, only the known formats, best-ofs, and station counts, and removes a bracket\'s lists with it', () => {
    const db = openDatabase(':memory:');
    db.exec("INSERT INTO events (name, created_at) VALUES ('Friday', 't')");
    const insert = db.prepare('INSERT INTO brackets (event_id, format, best_of, stations, seeding, created_at) VALUES (1, ?, ?, ?, \'[]\', \'t\')');
    expect(() => insert.run('swiss', 1, 1)).toThrow(/CHECK/);
    expect(() => insert.run('single', 2, 1)).toThrow(/CHECK/);
    expect(() => insert.run('single', 1, 0)).toThrow(/CHECK/);
    expect(() => insert.run('single', 1, 9)).toThrow(/CHECK/);
    insert.run('single', 1, 8);
    expect(() => insert.run('double', 3, 2)).toThrow(/UNIQUE/);

    db.exec("INSERT INTO bracket_results (bracket_id, match_id, winner_id, loser_id, at) VALUES (1, 0, 1, 2, 't')");
    db.exec('INSERT INTO bracket_late_joins (bracket_id, position, player_id, step) VALUES (1, 0, 3, 0)');
    db.exec('INSERT INTO bracket_tie_breaks (bracket_id, position, round, player_a, player_b, step) VALUES (1, 0, 1, 1, 2, 0)');
    expect(() => db.exec('INSERT INTO bracket_late_joins (bracket_id, position, player_id, step) VALUES (1, 0, 4, 0)')).toThrow(/UNIQUE|PRIMARY/);
    expect(() => db.exec("INSERT INTO bracket_results (bracket_id, match_id, winner_id, loser_id, at) VALUES (9, 0, 1, 2, 't')")).toThrow(/FOREIGN/);
    db.exec('DELETE FROM brackets');
    for (const table of ['bracket_results', 'bracket_late_joins', 'bracket_tie_breaks']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
    }
  });

  it('never gives out an id twice, even after the rows are deleted', () => {
    const db = openDatabase(':memory:');
    db.exec("INSERT INTO events (name, created_at) VALUES ('Friday', 't')");
    db.exec("INSERT INTO brackets (event_id, format, best_of, stations, seeding, created_at) VALUES (1, 'single', 1, 1, '[]', 't')");
    db.exec("INSERT INTO bracket_results (bracket_id, match_id, winner_id, loser_id, at) VALUES (1, 0, 1, 2, 't')");
    db.exec('DELETE FROM bracket_results');
    db.exec("INSERT INTO bracket_results (bracket_id, match_id, winner_id, loser_id, at) VALUES (1, 0, 1, 2, 't')");
    expect(db.prepare('SELECT id FROM bracket_results').all()).toEqual([{ id: 2 }]);
  });
});

describe('migration 4 (older undos)', () => {
  /** A database as M4 left it: schema version 3, with a bracket and two results. */
  function m4Database(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    for (const step of MIGRATIONS.slice(0, 3)) db.exec(step);
    db.exec('PRAGMA user_version = 3');
    db.exec(`
      INSERT INTO events (name, created_at) VALUES ('Friday', 't1');
      INSERT INTO brackets (event_id, format, best_of, stations, seeding, created_at) VALUES (1, 'single', 1, 2, '[1,2,3,4]', 't2');
      INSERT INTO bracket_results (bracket_id, match_id, winner_id, loser_id, at) VALUES (1, 0, 1, 4, 't3'), (1, 1, 2, 3, 't4');
    `);
    return db;
  }

  it('keeps every result of an M4 bracket as standing, with no undo', () => {
    const db = m4Database();
    const before = db.prepare('SELECT id, bracket_id, match_id, winner_id, loser_id, at FROM bracket_results ORDER BY id').all();
    migrate(db);
    expect(version(db)).toBe(4);
    expect(db.prepare('SELECT id, bracket_id, match_id, winner_id, loser_id, at FROM bracket_results ORDER BY id').all()).toEqual(before);
    expect(db.prepare('SELECT undone_step, undone_at FROM bracket_results').all()).toEqual([
      { undone_step: null, undone_at: null },
      { undone_step: null, undone_at: null },
    ]);
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });

  it('takes an undo only as a step and a time together', () => {
    const db = m4Database();
    migrate(db);
    expect(() => db.exec('UPDATE bracket_results SET undone_step = 2 WHERE id = 1')).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE bracket_results SET undone_at = 't5' WHERE id = 1")).toThrow(/CHECK/);
    db.exec("UPDATE bracket_results SET undone_step = 2, undone_at = 't5' WHERE id = 1");
    expect(db.prepare('SELECT undone_step, undone_at FROM bracket_results WHERE id = 1').get()).toEqual({ undone_step: 2, undone_at: 't5' });
  });
});

describe('openDatabase on a file', () => {
  it('creates the folder, uses WAL, and keeps data across a reopen', async () => {
    dir = await mkdtemp(join(tmpdir(), 'coliseumgrid-db-'));
    const file = join(dir, 'nested', 'deeper', 'test.db');
    const db = openDatabase(file);
    expect(existsSync(file)).toBe(true);
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    db.prepare("INSERT INTO events (name, created_at) VALUES ('Friday', 't')").run();
    db.close();

    const again = openDatabase(file);
    expect(version(again)).toBe(MIGRATIONS.length);
    expect(again.prepare('SELECT name FROM events').all()).toEqual([{ name: 'Friday' }]);
    again.close();
  });
});
