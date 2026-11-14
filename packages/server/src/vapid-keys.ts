// The server's VAPID key pair (RFC 8292, <https://www.rfc-editor.org/rfc/rfc8292>): an ECDSA
// P-256 key that signs the token on every push request, so the push service knows the pushes
// come from the same server that the phone subscribed with. The phone's browser is given the
// public key as `applicationServerKey` when it subscribes (<https://www.w3.org/TR/push-api/>).
//
// The key is made once and kept in DATA_DIR. A push service ties each subscription to the key
// it was made with, so a new key would quietly break every phone's alerts. That is why a file
// that can't be read is never replaced: this file throws, and push-notify.ts turns push off
// with a warning in the log. The server keeps running; the host fixes or restores the file
// and restarts it.

import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const VAPID_KEY_FILE = 'vapid-private-key.pem';

export interface VapidKeys {
  /** The uncompressed P-256 point (0x04, x, y; 65 bytes) in base64url, as RFC 8292 section 3.2 sends it in `k`. */
  publicKey: string;
  privateKey: KeyObject;
}

/** Loads the key pair from `dataDir`, making and saving it first if there is none. */
export function loadOrCreateVapidKeys(dataDir: string): VapidKeys {
  const file = join(dataDir, VAPID_KEY_FILE);
  let pem: string;
  try {
    pem = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    pem = createKeyFile(dataDir, file);
  }
  return fromPem(pem, file);
}

function createKeyFile(dataDir: string, file: string): string {
  mkdirSync(dataDir, { recursive: true });
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  try {
    // 'wx' fails if the file exists, so two servers starting at once can't each write a
    // different key; the loser reads the winner's. Mode 0600: the key is the server's identity
    // to the push services, so only the owner may read it.
    writeFileSync(file, pem, { flag: 'wx', mode: 0o600 });
    return pem;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return readFileSync(file, 'utf8');
  }
}

function fromPem(pem: string, file: string): VapidKeys {
  const unreadable = new Error(
    `The push key file ${file} is not a P-256 private key. Put back the file from a backup. ` +
      'Deleting it makes a new key, and then every phone has to turn alerts on again.',
  );
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(pem);
  } catch {
    throw unreadable;
  }
  if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw unreadable;
  }
  // The JWK's x and y are the point's coordinates, 32 bytes each for P-256 (RFC 7518, 6.2.1).
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x as string, 'base64url'),
    Buffer.from(jwk.y as string, 'base64url'),
  ]);
  return { publicKey: point.toString('base64url'), privateKey };
}
