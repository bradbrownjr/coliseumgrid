import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS, inTransaction, migrate, openDatabase } from '../src/database.ts';

const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const columns = (db: DatabaseSync, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

/** The columns migration 7 added to old tables. A database from before it has no values for them, so the older migration tests leave them out of a row dump. */
const M7_COLUMNS = ['game', 'plan', 'forfeit', 'missing'];
const dump = (db: DatabaseSync, table: string) =>
  db
    .prepare(`SELECT * FROM ${table} ORDER BY 1, 2`)
    .all()
    .map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !M7_COLUMNS.includes(key))));

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
    expect(columns(db, 'events')).toEqual(['id', 'name', 'created_at', 'game', 'plan']);
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

  const OLD_TABLES = ['players', 'events', 'host_settings', 'host_sessions', 'pairing_codes', 'devices'];

  it('adds the bracket tables to a database that has M2 and M3 data, and keeps every old row', () => {
    const db = oldDatabase();
    const before = OLD_TABLES.map((t) => dump(db, t));
    migrate(db);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(OLD_TABLES.map((t) => dump(db, t))).toEqual(before);
    expect(columns(db, 'brackets')).toEqual(['id', 'event_id', 'format', 'best_of', 'stations', 'seeding', 'created_at']);
    // undone_at and undone_step are migration 4's.
    expect(columns(db, 'bracket_results')).toEqual(['id', 'bracket_id', 'match_id', 'winner_id', 'loser_id', 'at', 'undone_at', 'undone_step', 'forfeit']);
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
    expect(version(db)).toBe(MIGRATIONS.length);
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

describe('migration 5 (heats)', () => {
  /** A database as M4 left it: schema version 4, with players, an event, a finished bracket, and a device. */
  function m4Database(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    for (const step of MIGRATIONS.slice(0, 4)) db.exec(step);
    db.exec('PRAGMA user_version = 4');
    db.exec(`
      INSERT INTO players (handle, handle_key, pin_hash, created_at) VALUES ('Zap', 'zap', 'h1', 't1'), ('Bolt', 'bolt', 'h2', 't2');
      INSERT INTO events (name, created_at) VALUES ('Friday', 't3');
      INSERT INTO host_settings (id, password_hash, updated_at) VALUES (1, 'ph', 't4');
      INSERT INTO devices (role, label, token_hash, last_seen, created_at) VALUES ('signup', 'Sign-up 1', 'd1', 't9', 't10');
      INSERT INTO event_players (event_id, player_id) VALUES (1, 1), (1, 2);
      INSERT INTO brackets (event_id, format, best_of, stations, seeding, created_at) VALUES (1, 'single', 1, 2, '[1,2]', 't11');
      INSERT INTO bracket_results (bracket_id, match_id, winner_id, loser_id, at, undone_step, undone_at) VALUES (1, 0, 1, 2, 't12', 1, 't13');
    `);
    return db;
  }

  const OLD_TABLES = ['players', 'events', 'host_settings', 'devices', 'event_players', 'brackets', 'bracket_results'];

  it('adds the heat tables to a database that has M2 to M4 data, and keeps every old row', () => {
    const db = m4Database();
    const before = OLD_TABLES.map((t) => dump(db, t));
    migrate(db);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(OLD_TABLES.map((t) => dump(db, t))).toEqual(before);
    expect(columns(db, 'heat_runs')).toEqual(['id', 'event_id', 'stations', 'races', 'rounds', 'points', 'seeding', 'created_at']);
    expect(columns(db, 'heat_results')).toEqual(['id', 'run_id', 'heat_id', 'finish_order', 'at', 'undone_step', 'undone_at', 'missing']);
    expect(columns(db, 'heat_late_joins')).toEqual(['run_id', 'position', 'player_id', 'heat_id', 'step']);
    expect(columns(db, 'heat_tie_breaks')).toEqual(['run_id', 'position', 'players', 'step']);
    for (const table of ['heat_runs', 'heat_results', 'heat_late_joins', 'heat_tie_breaks']) expect(dump(db, table), table).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });

  it('lets the old data and the new tables be used together, and leaves the bracket tables as they were', () => {
    const db = m4Database();
    migrate(db);
    db.exec("INSERT INTO heat_runs (event_id, stations, races, rounds, points, seeding, created_at) VALUES (1, 2, 2, 2, '[4,3,2,1]', '[1,2,3,4,5]', 't')");
    db.exec("INSERT INTO heat_results (run_id, heat_id, finish_order, at) VALUES (1, 101, '[1,2,3]', 't')");
    expect(db.prepare('SELECT COUNT(*) AS n FROM brackets').get()).toEqual({ n: 1 });
    expect(columns(db, 'bracket_results')).toEqual(['id', 'bracket_id', 'match_id', 'winner_id', 'loser_id', 'at', 'undone_at', 'undone_step', 'forfeit']);
  });

  it('also upgrades a database that is still at M2', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS[0] as string);
    db.exec('PRAGMA user_version = 1');
    db.exec("INSERT INTO players (handle, handle_key, pin_hash, created_at) VALUES ('Zap', 'zap', 'h1', 't1')");
    migrate(db);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(columns(db, 'heat_runs')).toContain('seeding');
    expect(db.prepare('SELECT handle FROM players').all()).toEqual([{ handle: 'Zap' }]);
  });

  it('allows one run per event and only the known station, race, and round counts', () => {
    const db = openDatabase(':memory:');
    db.exec("INSERT INTO events (name, created_at) VALUES ('Friday', 't')");
    const insert = db.prepare("INSERT INTO heat_runs (event_id, stations, races, rounds, points, seeding, created_at) VALUES (1, ?, ?, ?, '[4,3,2,1]', '[]', 't')");
    expect(() => insert.run(0, 1, 1)).toThrow(/CHECK/);
    expect(() => insert.run(9, 1, 1)).toThrow(/CHECK/);
    expect(() => insert.run(1, 0, 1)).toThrow(/CHECK/);
    expect(() => insert.run(1, 5, 1)).toThrow(/CHECK/);
    expect(() => insert.run(1, 1, -1)).toThrow(/CHECK/);
    expect(() => insert.run(1, 1, 4)).toThrow(/CHECK/);
    insert.run(8, 4, 0);
    expect(() => insert.run(1, 1, 1)).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO heat_runs (event_id, stations, races, rounds, points, seeding, created_at) VALUES (99, 1, 1, 1, '[]', '[]', 't')")).toThrow(/FOREIGN/);
  });

  it('takes an undo only as a step and a time together', () => {
    const db = openDatabase(':memory:');
    db.exec("INSERT INTO events (name, created_at) VALUES ('Friday', 't')");
    db.exec("INSERT INTO heat_runs (event_id, stations, races, rounds, points, seeding, created_at) VALUES (1, 1, 1, 1, '[4,3,2,1]', '[]', 't')");
    const insert = db.prepare("INSERT INTO heat_results (run_id, heat_id, finish_order, at, undone_step, undone_at) VALUES (1, 101, '[1,2]', 't', ?, ?)");
    expect(() => insert.run(2, null)).toThrow(/CHECK/);
    expect(() => insert.run(null, 't2')).toThrow(/CHECK/);
    insert.run(null, null);
    insert.run(2, 't2');
    expect(db.prepare('SELECT undone_step, undone_at FROM heat_results ORDER BY id').all()).toEqual([
      { undone_step: null, undone_at: null },
      { undone_step: 2, undone_at: 't2' },
    ]);
  });

  it('removes a run\'s lists with it, and keeps each list\'s positions unique', () => {
    const db = openDatabase(':memory:');
    db.exec("INSERT INTO events (name, created_at) VALUES ('Friday', 't')");
    db.exec("INSERT INTO heat_runs (event_id, stations, races, rounds, points, seeding, created_at) VALUES (1, 1, 1, 1, '[4,3,2,1]', '[]', 't')");
    db.exec("INSERT INTO heat_results (run_id, heat_id, finish_order, at) VALUES (1, 101, '[1,2]', 't')");
    db.exec('INSERT INTO heat_late_joins (run_id, position, player_id, heat_id, step) VALUES (1, 0, 3, 101, 0)');
    db.exec("INSERT INTO heat_tie_breaks (run_id, position, players, step) VALUES (1, 0, '[1,2]', 1)");
    expect(() => db.exec('INSERT INTO heat_late_joins (run_id, position, player_id, heat_id, step) VALUES (1, 0, 4, 101, 0)')).toThrow(/UNIQUE|PRIMARY/);
    expect(() => db.exec("INSERT INTO heat_tie_breaks (run_id, position, players, step) VALUES (1, 0, '[3,4]', 1)")).toThrow(/UNIQUE|PRIMARY/);
    expect(() => db.exec("INSERT INTO heat_results (run_id, heat_id, finish_order, at) VALUES (9, 101, '[1,2]', 't')")).toThrow(/FOREIGN/);
    db.exec('DELETE FROM heat_runs');
    for (const table of ['heat_results', 'heat_late_joins', 'heat_tie_breaks']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
    }
  });

  it('never gives out a run or result id twice, even after the rows are deleted', () => {
    const db = openDatabase(':memory:');
    db.exec("INSERT INTO events (name, created_at) VALUES ('Friday', 't')");
    const run = "INSERT INTO heat_runs (event_id, stations, races, rounds, points, seeding, created_at) VALUES (1, 1, 1, 1, '[4,3,2,1]', '[]', 't')";
    db.exec(run);
    db.exec("INSERT INTO heat_results (run_id, heat_id, finish_order, at) VALUES (1, 101, '[1,2]', 't')");
    db.exec('DELETE FROM heat_results');
    db.exec("INSERT INTO heat_results (run_id, heat_id, finish_order, at) VALUES (1, 101, '[1,2]', 't')");
    expect(db.prepare('SELECT id FROM heat_results').all()).toEqual([{ id: 2 }]);
    db.exec('DELETE FROM heat_runs');
    db.exec(run);
    expect(db.prepare('SELECT id FROM heat_runs').all()).toEqual([{ id: 2 }]);
  });
});

describe('inTransaction', () => {
  it('rolls back only the inner work when an inner step fails and the outer one carries on', () => {
    const db = openDatabase(':memory:');
    const insert = (name: string) => db.prepare("INSERT INTO events (name, created_at) VALUES (?, 't')").run(name);
    inTransaction(db, () => {
      insert('outer');
      expect(() => inTransaction(db, () => { insert('inner'); throw new Error('boom'); })).toThrow('boom');
      inTransaction(db, () => insert('kept'));
    });
    expect(db.prepare('SELECT name FROM events ORDER BY id').all()).toEqual([{ name: 'outer' }, { name: 'kept' }]);
  });

  it('rolls everything back when the outer work fails after an inner step finished', () => {
    const db = openDatabase(':memory:');
    expect(() => inTransaction(db, () => {
      inTransaction(db, () => db.prepare("INSERT INTO events (name, created_at) VALUES ('inner', 't')").run());
      throw new Error('boom');
    })).toThrow('boom');
    expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 0 });
    expect(db.isTransaction).toBe(false);
  });
});

describe('migration 6 (phones)', () => {
  /** A database as M5 left it: schema version 5, with players, a bracket, heats, and a device. */
  function m5Database(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    for (const step of MIGRATIONS.slice(0, 5)) db.exec(step);
    db.exec('PRAGMA user_version = 5');
    db.exec(`
      INSERT INTO players (handle, handle_key, pin_hash, created_at) VALUES ('Zap', 'zap', 'h1', 't1'), ('Bolt', 'bolt', 'h2', 't2');
      INSERT INTO events (name, created_at) VALUES ('Friday', 't3');
      INSERT INTO host_settings (id, password_hash, updated_at) VALUES (1, 'ph', 't4');
      INSERT INTO devices (role, label, token_hash, last_seen, created_at) VALUES ('signup', 'Sign-up 1', 'd1', 't9', 't10');
      INSERT INTO event_players (event_id, player_id) VALUES (1, 1), (1, 2);
      INSERT INTO brackets (event_id, format, best_of, stations, seeding, created_at) VALUES (1, 'single', 1, 2, '[1,2]', 't11');
      INSERT INTO bracket_results (bracket_id, match_id, winner_id, loser_id, at) VALUES (1, 0, 1, 2, 't12');
      INSERT INTO heat_runs (event_id, stations, races, rounds, points, seeding, created_at) VALUES (1, 1, 1, 1, '[4,3,2,1]', '[1,2]', 't13');
      INSERT INTO heat_results (run_id, heat_id, finish_order, at) VALUES (1, 101, '[1,2]', 't14');
    `);
    return db;
  }

  const OLD_TABLES = [
    'players', 'events', 'host_settings', 'devices', 'event_players', 'brackets', 'bracket_results', 'heat_runs', 'heat_results',
  ];

  it('adds the phone tables to a database with M2 to M5 data, and keeps every old row', () => {
    const db = m5Database();
    const before = OLD_TABLES.map((t) => dump(db, t));
    migrate(db);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(OLD_TABLES.map((t) => dump(db, t))).toEqual(before);
    expect(columns(db, 'phones')).toEqual(['id', 'token_hash', 'last_seen', 'created_at']);
    expect(columns(db, 'phone_follows')).toEqual(['phone_id', 'player_id', 'created_at']);
    expect(columns(db, 'follow_codes')).toEqual(['code', 'player_id', 'created_at', 'expires_at', 'used_at']);
    expect(columns(db, 'push_subscriptions')).toEqual(['phone_id', 'endpoint', 'p256dh', 'auth', 'created_at']);
    for (const table of ['phones', 'phone_follows', 'follow_codes', 'push_subscriptions']) expect(dump(db, table), table).toEqual([]);
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
    expect(columns(db, 'phones')).toContain('token_hash');
    expect(db.prepare('SELECT handle FROM players').all()).toEqual([{ handle: 'Zap' }]);
  });

  it('removes a phone with its follows and push subscription, and a player with the follows and codes on it', () => {
    const db = m5Database();
    migrate(db);
    db.exec(`
      INSERT INTO phones (token_hash, last_seen, created_at) VALUES ('t1', 't', 't');
      INSERT INTO phone_follows (phone_id, player_id, created_at) VALUES (1, 1, 't'), (1, 2, 't');
      INSERT INTO follow_codes (code, player_id, created_at, expires_at) VALUES ('AAAAAA', 1, 't', 't');
      INSERT INTO push_subscriptions (phone_id, endpoint, p256dh, auth, created_at) VALUES (1, 'e', 'p', 'a', 't');
    `);
    db.exec('DELETE FROM players WHERE id = 1');
    expect(db.prepare('SELECT player_id FROM phone_follows').all()).toEqual([{ player_id: 2 }]);
    expect(dump(db, 'follow_codes')).toEqual([]);
    db.exec('DELETE FROM phones');
    expect(dump(db, 'phone_follows')).toEqual([]);
    expect(dump(db, 'push_subscriptions')).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM players').get()).toEqual({ n: 1 });
  });

  it('stores one token hash per phone, one subscription per phone, and one phone per endpoint', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      INSERT INTO phones (token_hash, last_seen, created_at) VALUES ('t1', 't', 't'), ('t2', 't', 't');
      INSERT INTO push_subscriptions (phone_id, endpoint, p256dh, auth, created_at) VALUES (1, 'e1', 'p', 'a', 't');
    `);
    expect(() => db.exec("INSERT INTO phones (token_hash, last_seen, created_at) VALUES ('t1', 't', 't')")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO push_subscriptions (phone_id, endpoint, p256dh, auth, created_at) VALUES (1, 'e2', 'p', 'a', 't')")).toThrow(/UNIQUE|PRIMARY/);
    expect(() => db.exec("INSERT INTO push_subscriptions (phone_id, endpoint, p256dh, auth, created_at) VALUES (2, 'e1', 'p', 'a', 't')")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO phone_follows (phone_id, player_id, created_at) VALUES (1, 99, 't')")).toThrow(/FOREIGN/);
  });
});

describe('migration 7 (the setup wizard)', () => {
  /** A database as M6 left it: schema version 6, with an event, a played bracket, and played heats, one result of each undone. */
  function m6Database(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    for (const step of MIGRATIONS.slice(0, 6)) db.exec(step);
    db.exec('PRAGMA user_version = 6');
    db.exec(`
      INSERT INTO players (handle, handle_key, pin_hash, created_at) VALUES ('Zap', 'zap', 'h1', 't1'), ('Bolt', 'bolt', 'h2', 't2');
      INSERT INTO events (name, created_at) VALUES ('Friday', 't3');
      INSERT INTO event_players (event_id, player_id) VALUES (1, 1), (1, 2);
      INSERT INTO brackets (event_id, format, best_of, stations, seeding, created_at) VALUES (1, 'single', 1, 1, '[1,2]', 't4');
      INSERT INTO bracket_results (bracket_id, match_id, winner_id, loser_id, at) VALUES (1, 0, 1, 2, 't5');
      INSERT INTO heat_runs (event_id, stations, races, rounds, points, seeding, created_at) VALUES (1, 1, 1, 1, '[4,3,2,1]', '[1,2]', 't6');
      INSERT INTO heat_results (run_id, heat_id, finish_order, at) VALUES (1, 2000, '[2,1]', 't7');
    `);
    return db;
  }

  const OLD_TABLES = ['players', 'events', 'event_players', 'brackets', 'bracket_results', 'heat_runs', 'heat_results'];

  it('adds the game, plan, forfeit, and missing columns to a version 6 database and keeps every old row', () => {
    const db = m6Database();
    const before = OLD_TABLES.map((t) => dump(db, t));
    migrate(db);
    expect(version(db)).toBe(7);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(OLD_TABLES.map((t) => dump(db, t))).toEqual(before);
    expect(columns(db, 'events')).toEqual(['id', 'name', 'created_at', 'game', 'plan']);
    expect(columns(db, 'bracket_results')).toContain('forfeit');
    expect(columns(db, 'heat_results')).toContain('missing');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });

  it('gives old rows no game, no plan, no forfeit, and no missing players', () => {
    const db = m6Database();
    migrate(db);
    expect(db.prepare('SELECT game, plan FROM events').all()).toEqual([{ game: null, plan: null }]);
    expect(db.prepare('SELECT forfeit FROM bracket_results').all()).toEqual([{ forfeit: 0 }]);
    expect(db.prepare('SELECT missing FROM heat_results').all()).toEqual([{ missing: null }]);
  });

  it('takes a forfeit of 0 or 1 and nothing else', () => {
    const db = m6Database();
    migrate(db);
    const insert = db.prepare("INSERT INTO bracket_results (bracket_id, match_id, winner_id, loser_id, at, forfeit) VALUES (1, 1, 1, 2, 't', ?)");
    insert.run(1);
    expect(() => insert.run(2)).toThrow(/CHECK/);
    expect(() => insert.run(null)).toThrow(/NOT NULL/);
  });

  it('also upgrades a database that is still at M2', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS[0] as string);
    db.exec('PRAGMA user_version = 1');
    db.exec("INSERT INTO events (name, created_at) VALUES ('Friday', 't')");
    migrate(db);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(db.prepare('SELECT name, game, plan FROM events').all()).toEqual([{ name: 'Friday', game: null, plan: null }]);
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
