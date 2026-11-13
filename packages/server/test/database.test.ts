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
