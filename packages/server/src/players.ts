// The players table. Every query names its columns, so pin_hash, handle_key, and created_at
// stay inside this file unless a caller asks for the hash (CLAUDE.md, rule 1). The statements
// are synchronous, so a lookup followed by a write in the same tick can't be interleaved
// with another request; the UNIQUE column on handle_key is the backstop.

import type { Player } from '@coliseumgrid/core';
import type { Database } from './database.ts';

export interface PlayerWithHash extends Player {
  pinHash: string;
}

export interface Players {
  list(): Player[];
  get(id: number): Player | undefined;
  getByKey(key: string): PlayerWithHash | undefined;
  /** Null when another player already has the key. */
  create(handle: string, key: string, pinHash: string): Player | null;
  /** The player is renamed, or the answer says why not. A new case for the same key is allowed. */
  rename(id: number, handle: string, key: string): Player | 'taken' | 'not-found';
  setPinHash(id: number, pinHash: string): boolean;
  delete(id: number): boolean;
}

export function createPlayers(db: Database): Players {
  const list = db.prepare('SELECT id, handle FROM players ORDER BY handle_key, id');
  const get = db.prepare('SELECT id, handle FROM players WHERE id = ?');
  const getByKey = db.prepare('SELECT id, handle, pin_hash FROM players WHERE handle_key = ?');
  const insert = db.prepare('INSERT INTO players (handle, handle_key, pin_hash, created_at) VALUES (?, ?, ?, ?)');
  const update = db.prepare('UPDATE players SET handle = ?, handle_key = ? WHERE id = ?');
  const updatePin = db.prepare('UPDATE players SET pin_hash = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM players WHERE id = ?');

  const asPlayer = (row: Record<string, unknown>): Player => ({ id: row['id'] as number, handle: row['handle'] as string });

  return {
    list: () => list.all().map(asPlayer),
    get(id) {
      const row = get.get(id);
      return row && asPlayer(row);
    },
    getByKey(key) {
      const row = getByKey.get(key);
      return row && { ...asPlayer(row), pinHash: row['pin_hash'] as string };
    },
    create(handle, key, pinHash) {
      if (getByKey.get(key)) return null;
      const result = insert.run(handle, key, pinHash, new Date().toISOString());
      return { id: Number(result.lastInsertRowid), handle };
    },
    rename(id, handle, key) {
      if (!get.get(id)) return 'not-found';
      const holder = getByKey.get(key);
      if (holder && holder['id'] !== id) return 'taken';
      update.run(handle, key, id);
      return { id, handle };
    },
    setPinHash: (id, pinHash) => updatePin.run(pinHash, id).changes > 0,
    delete: (id) => remove.run(id).changes > 0,
  };
}
