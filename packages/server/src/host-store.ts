// The host's password hash and sign-in sessions. Only hashes are stored (tokens.ts). Times are
// ISO 8601 UTC text, so `expires_at > ?` compares them correctly as text.

import { iso, type Clock } from './clock.ts';
import type { Database } from './database.ts';

/** A host session lasts 12 hours (docs/PLAN.md, "Devices and host API"), from sign-in, never extended. */
export const HOST_SESSION_MS = 12 * 60 * 60 * 1000;

export interface HostStore {
  getPasswordHash(): string | undefined;
  /** False when a password is already stored; the first writer wins. */
  setPasswordHash(hash: string): boolean;
  createSession(tokenHash: string): void;
  sessionValid(tokenHash: string): boolean;
  deleteSession(tokenHash: string): void;
}

export function createHostStore(db: Database, now: Clock): HostStore {
  const getPassword = db.prepare('SELECT password_hash FROM host_settings WHERE id = 1');
  const insertPassword = db.prepare(
    'INSERT OR IGNORE INTO host_settings (id, password_hash, updated_at) VALUES (1, ?, ?)',
  );
  const insertSession = db.prepare('INSERT INTO host_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)');
  const purge = db.prepare('DELETE FROM host_sessions WHERE expires_at <= ?');
  const getSession = db.prepare('SELECT 1 AS ok FROM host_sessions WHERE token_hash = ? AND expires_at > ?');
  const removeSession = db.prepare('DELETE FROM host_sessions WHERE token_hash = ?');

  return {
    getPasswordHash: () => getPassword.get()?.['password_hash'] as string | undefined,
    setPasswordHash: (hash) => insertPassword.run(hash, iso(now())).changes > 0,
    createSession(tokenHash) {
      const at = now();
      // Expired rows go when a new session starts, so the table stays at the live ones.
      purge.run(iso(at));
      insertSession.run(tokenHash, iso(at), iso(at + HOST_SESSION_MS));
    },
    sessionValid: (tokenHash) => getSession.get(tokenHash, iso(now())) !== undefined,
    deleteSession: (tokenHash) => {
      removeSession.run(tokenHash);
    },
  };
}
