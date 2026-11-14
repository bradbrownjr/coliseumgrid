import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateVapidKeys, VAPID_KEY_FILE } from '../src/vapid-keys.ts';

describe('loadOrCreateVapidKeys', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coliseumgrid-vapid-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('makes a P-256 key whose public key is the 65-byte uncompressed point', () => {
    const keys = loadOrCreateVapidKeys(dir);
    expect(keys.privateKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
    const point = Buffer.from(keys.publicKey, 'base64url');
    expect(point.length).toBe(65);
    expect(point[0]).toBe(0x04);
    // The point is the private key's own public key: a signature checks out against it.
    const publicKey = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') },
      format: 'jwk',
    });
    const signature = sign('sha256', Buffer.from('x'), keys.privateKey);
    expect(verify('sha256', Buffer.from('x'), publicKey, signature)).toBe(true);
  });

  it('saves the key readable only by its owner', () => {
    loadOrCreateVapidKeys(dir);
    const file = join(dir, VAPID_KEY_FILE);
    expect(readFileSync(file, 'utf8')).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('loads the same key after', () => {
    const first = loadOrCreateVapidKeys(dir);
    const second = loadOrCreateVapidKeys(dir);
    expect(second.publicKey).toBe(first.publicKey);
    expect(second.privateKey.equals(first.privateKey)).toBe(true);
  });

  it('makes the data folder if it is missing', () => {
    const nested = join(dir, 'a', 'b');
    expect(loadOrCreateVapidKeys(nested).publicKey).toHaveLength(87); // 65 bytes in base64url
  });

  it.each([
    ['not a key', 'hello'],
    ['empty', ''],
    ['a cut-off key', () => readFileSync(join(dir, 'whole.pem'), 'utf8').slice(0, 100)],
    ['a key on another curve', () => generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()],
    ['an Ed25519 key', () => generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()],
  ])('stops with a plain message for %s and keeps the file', (_name, contents) => {
    writeFileSync(join(dir, 'whole.pem'), generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }));
    const text = typeof contents === 'string' ? contents : contents();
    const file = join(dir, VAPID_KEY_FILE);
    writeFileSync(file, text);
    expect(() => loadOrCreateVapidKeys(dir)).toThrow(/is not a P-256 private key.*every phone has to turn alerts on again/);
    expect(readFileSync(file, 'utf8')).toBe(text);
  });
});
