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
