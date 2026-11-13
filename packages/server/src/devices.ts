// Pairing codes and paired devices (docs/PLAN.md, "Pairing a device"). Every query names its
// columns, so token_hash stays inside this file (CLAUDE.md, rule 1). The statements are
// synchronous: a code is spent with one UPDATE that checks "unused and not expired" in its
// WHERE clause, so two requests with the same code can't both win.

import { generateJoinCode, type Device, type DeviceRole, type RandomSource } from '@coliseumgrid/core';
import { iso, type Clock } from './clock.ts';
import { inTransaction, type Database } from './database.ts';

/** A pairing code works for 10 minutes (docs/PLAN.md, "Pairing a device"). */
export const PAIRING_CODE_MS = 10 * 60 * 1000;

/**
 * A device's last_seen is refreshed at most this often on API use. A TV polls nothing, but a
 * tablet signing kids up sends many requests; one write a minute is enough to tell the host
 * which screens are alive, without a write per request.
 */
export const LAST_SEEN_THROTTLE_MS = 60 * 1000;

const LABEL_NAMES: Record<DeviceRole, string> = { display: 'Display', signup: 'Sign-up' };

export interface NewPairingCode {
  code: string;
  role: DeviceRole;
  expiresAt: string;
}

export interface Devices {
  /** Makes a new code. Several can be live at once; each pairs one device. */
  createCode(role: DeviceRole, random: RandomSource): NewPairingCode;
  /** Spends the (canonical) code and adds the device, or returns null for an unknown, used, or expired code. */
  pair(code: string, tokenHash: string): Device | null;
  getByTokenHash(tokenHash: string): Device | undefined;
  get(id: number): Device | undefined;
  list(): Device[];
  remove(id: number): boolean;
  /** Sets last_seen to now. `throttled` skips the write when it was refreshed within LAST_SEEN_THROTTLE_MS. */
  touch(id: number, throttled: boolean): void;
}

export function createDevices(db: Database, now: Clock): Devices {
  const asDevice = (row: Record<string, unknown>): Device => ({
    id: row['id'] as number,
    role: row['role'] as DeviceRole,
    label: row['label'] as string,
    lastSeen: row['last_seen'] as string,
  });

  const purgeCodes = db.prepare('DELETE FROM pairing_codes WHERE expires_at <= ? OR used_at IS NOT NULL');
  const findCode = db.prepare('SELECT 1 AS taken FROM pairing_codes WHERE code = ?');
  const insertCode = db.prepare('INSERT INTO pairing_codes (code, role, created_at, expires_at) VALUES (?, ?, ?, ?)');
  const spendCode = db.prepare(
    'UPDATE pairing_codes SET used_at = ? WHERE code = ? AND used_at IS NULL AND expires_at > ? RETURNING role',
  );
  const labelsOf = db.prepare('SELECT label FROM devices WHERE role = ?');
  const insertDevice = db.prepare(
    'INSERT INTO devices (role, label, token_hash, last_seen, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const byHash = db.prepare('SELECT id, role, label, last_seen FROM devices WHERE token_hash = ?');
  const byId = db.prepare('SELECT id, role, label, last_seen FROM devices WHERE id = ?');
  const all = db.prepare('SELECT id, role, label, last_seen FROM devices ORDER BY id');
  const removeDevice = db.prepare('DELETE FROM devices WHERE id = ?');
  const touchAlways = db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?');
  const touchOld = db.prepare('UPDATE devices SET last_seen = ? WHERE id = ? AND last_seen <= ?');

  /** "Display 1", "Sign-up 2": the lowest number no paired device of the role is using. */
  function nextLabel(role: DeviceRole): string {
    const name = LABEL_NAMES[role];
    const used = new Set(labelsOf.all(role).map((row) => Number(String(row['label']).slice(name.length + 1))));
    let n = 1;
    while (used.has(n)) n++;
    return `${name} ${n}`;
  }

  return {
    createCode(role, random) {
      const at = now();
      return inTransaction(db, () => {
        // Spent and expired codes go now, so a new code can't collide with a dead one.
        purgeCodes.run(iso(at));
        let code = generateJoinCode(random);
        while (findCode.get(code)) code = generateJoinCode(random);
        const expiresAt = iso(at + PAIRING_CODE_MS);
        insertCode.run(code, role, iso(at), expiresAt);
        return { code, role, expiresAt };
      });
    },
    pair(code, tokenHash) {
      const at = now();
      return inTransaction(db, () => {
        const spent = spendCode.get(iso(at), code, iso(at));
        if (!spent) return null;
        const role = spent['role'] as DeviceRole;
        const label = nextLabel(role);
        const result = insertDevice.run(role, label, tokenHash, iso(at), iso(at));
        return { id: Number(result.lastInsertRowid), role, label, lastSeen: iso(at) };
      });
    },
    getByTokenHash(tokenHash) {
      const row = byHash.get(tokenHash);
      return row && asDevice(row);
    },
    get(id) {
      const row = byId.get(id);
      return row && asDevice(row);
    },
    list: () => all.all().map(asDevice),
    remove: (id) => removeDevice.run(id).changes > 0,
    touch(id, throttled) {
      const at = now();
      if (throttled) touchOld.run(iso(at), id, iso(at - LAST_SEEN_THROTTLE_MS));
      else touchAlways.run(iso(at), id);
    },
  };
}
