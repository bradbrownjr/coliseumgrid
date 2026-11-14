import { createDecipheriv, createECDH, createPublicKey, generateKeyPairSync, hkdfSync, verify } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  encryptPayload,
  isAllowedPushEndpoint,
  MAX_PLAINTEXT_BYTES,
  sendPush,
  vapidAuthorization,
  type PushSubscriptionRecord,
  type VapidConfig,
} from '../src/web-push.ts';

const b64 = (s: string): Buffer => Buffer.from(s.replace(/\s+/g, ''), 'base64url');

// RFC 8291, section 5 and Appendix A (<https://www.rfc-editor.org/rfc/rfc8291>).
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  authSecret: b64('BTBZMqHH6r4Tts7J_aSIgg'),
  uaPrivate: b64('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94'),
  uaPublic: b64('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'),
  asPrivate: b64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
  asPublic: b64('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
  salt: b64('DGv6ra1nlYgDCS1FRnbzlw'),
  header: b64(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
    mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8`),
  ciphertext: b64(`8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs
    bI_0LpXMuGvnzQ`),
  body: b64(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
    mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
    pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`),
};

/** The receiving side of RFC 8291 section 3.4, written from the RFC, to read what was sent. */
function decrypt(body: Buffer, uaPrivate: Buffer, authSecret: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const record = body.subarray(21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(asPublic), authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  return Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
}

function newVapid(subject = 'https://games.example.org'): VapidConfig {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([4]), b64(jwk.x as string), b64(jwk.y as string)]);
  return { publicKey: point.toString('base64url'), privateKey, subject };
}

function newSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123'): {
  sub: PushSubscriptionRecord;
  uaPrivate: Buffer;
  authSecret: Buffer;
} {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = Buffer.alloc(16, 7);
  return {
    sub: { endpoint, p256dh: ecdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') },
    uaPrivate: ecdh.getPrivateKey(),
    authSecret,
  };
}

describe('encryptPayload (RFC 8291)', () => {
  it('matches the worked example in RFC 8291 section 5 and Appendix A', () => {
    const body = encryptPayload(Buffer.from(RFC.plaintext), RFC.uaPublic, RFC.authSecret, {
      salt: RFC.salt,
      senderPrivateKey: RFC.asPrivate,
    });
    expect(body.subarray(0, 86).toString('base64url')).toBe(RFC.header.toString('base64url'));
    expect(body.subarray(86).toString('base64url')).toBe(RFC.ciphertext.toString('base64url'));
    expect(body.toString('base64url')).toBe(RFC.body.toString('base64url'));
    // Section 5's example says Content-Length 145, but its body decodes to 144 bytes:
    // 86 header + 41 plaintext + 1 delimiter + 16 tag.
    expect(body.length).toBe(144);
  });

  it('puts the sender key in keyid and a record size of 4096 in the header', () => {
    const body = encryptPayload(Buffer.from('hi'), RFC.uaPublic, RFC.authSecret, { senderPrivateKey: RFC.asPrivate });
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body.readUInt8(20)).toBe(65);
    expect(body.subarray(21, 86).equals(RFC.asPublic)).toBe(true);
  });

  it('uses a new salt and sender key each time, and the receiver can read it', () => {
    const a = encryptPayload(Buffer.from(RFC.plaintext), RFC.uaPublic, RFC.authSecret);
    const b = encryptPayload(Buffer.from(RFC.plaintext), RFC.uaPublic, RFC.authSecret);
    expect(a.subarray(0, 16).equals(b.subarray(0, 16))).toBe(false);
    expect(a.subarray(21, 86).equals(b.subarray(21, 86))).toBe(false);
    for (const body of [a, b]) {
      // The padding delimiter 0x02 ends the plaintext (RFC 8188, section 2).
      expect(decrypt(body, RFC.uaPrivate, RFC.authSecret).toString()).toBe(`${RFC.plaintext}\x02`);
    }
  });

  it('takes up to 3993 bytes, which fills 4096, and refuses more', () => {
    const body = encryptPayload(Buffer.alloc(MAX_PLAINTEXT_BYTES, 0x61), RFC.uaPublic, RFC.authSecret);
    expect(body.length).toBe(4096);
    expect(() => encryptPayload(Buffer.alloc(MAX_PLAINTEXT_BYTES + 1), RFC.uaPublic, RFC.authSecret)).toThrow(/at most 3993/);
  });

  it('refuses a key or secret of the wrong size', () => {
    expect(() => encryptPayload(Buffer.from('x'), RFC.uaPublic.subarray(0, 33), RFC.authSecret)).toThrow(/p256dh/);
    expect(() => encryptPayload(Buffer.from('x'), RFC.uaPublic, RFC.authSecret.subarray(0, 8))).toThrow(/auth/);
  });
});

describe('vapidAuthorization (RFC 8292)', () => {
  const now = Date.UTC(2026, 10, 14, 12, 0, 0);

  function parse(header: string): { t: string; k: string } {
    const match = /^vapid t=([^,]+), k=(\S+)$/.exec(header);
    expect(match).not.toBeNull();
    return { t: match?.[1] as string, k: match?.[2] as string };
  }

  it('is a vapid header whose ES256 token verifies with the public key in k', () => {
    const vapid = newVapid();
    const { t, k } = parse(vapidAuthorization('https://web.push.apple.com/QGuQyavXutnMH/abc', vapid, now));
    expect(k).toBe(vapid.publicKey);
    const [h, c, s] = t.split('.') as [string, string, string];
    const signature = b64(s);
    expect(signature.length).toBe(64); // raw r || s, not DER
    const point = b64(k);
    const publicKey = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') },
      format: 'jwk',
    });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)).toBe(true);
    expect(verify('sha256', Buffer.from(`${h}.${c}x`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)).toBe(false);
  });

  it('has the RFC 8292 header and claims: aud the origin, exp 12 hours out, sub', () => {
    const vapid = newVapid('mailto:host@example.org');
    const { t } = parse(vapidAuthorization('https://fcm.googleapis.com/fcm/send/xyz?x=1', vapid, now));
    const [h, c] = t.split('.') as [string, string];
    expect(JSON.parse(b64(h).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(b64(c).toString()) as { aud: string; exp: number; sub: string };
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: 'mailto:host@example.org' });
    expect(claims.exp - now / 1000).toBeLessThanOrEqual(24 * 3600);
  });

  it('refuses a subject that is not mailto: or https:', () => {
    expect(() => vapidAuthorization('https://fcm.googleapis.com/x', newVapid('http://localhost'), now)).toThrow(/subject/);
  });
});

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://web.push.apple.com/QGuQyavXutnMH',
    'https://wns2-bl2p.notify.windows.com/w/?token=BQYAAA',
    'https://FCM.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:443/fcm/send/abc',
  ])('allows %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ['plain http', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['another scheme', 'ftp://fcm.googleapis.com/abc'],
    ['an IPv4 literal', 'https://142.250.80.10/fcm/send/abc'],
    ['a private IPv4 literal', 'https://10.6.26.1/'],
    ['an IPv6 literal', 'https://[::1]/'],
    ['an IPv4-mapped IPv6 literal', 'https://[::ffff:127.0.0.1]/'],
    ['localhost', 'https://localhost/'],
    ['a localhost subdomain', 'https://fcm.googleapis.com.localhost/'],
    ['another host', 'https://example.com/push'],
    ['another Google host', 'https://android.googleapis.com/gcm/send/abc'],
    ['a lookalike suffix', 'https://fcm.googleapis.com.evil.example/fcm/send/abc'],
    ['a lookalike prefix', 'https://evilfcm.googleapis.com/abc'],
    ['an Apple lookalike', 'https://evilpush.apple.com/abc'],
    ['the bare Apple domain', 'https://push.apple.com/abc'],
    ['an Apple lookalike suffix', 'https://web.push.apple.com.evil.example/abc'],
    ['a Windows lookalike', 'https://evilnotify.windows.com/abc'],
    ['a trailing dot', 'https://fcm.googleapis.com./fcm/send/abc'],
    ['port 8443', 'https://fcm.googleapis.com:8443/fcm/send/abc'],
    ['port 80', 'https://fcm.googleapis.com:80/fcm/send/abc'],
    ['a user name', 'https://user@fcm.googleapis.com/fcm/send/abc'],
    ['a user name and password', 'https://user:pw@fcm.googleapis.com/fcm/send/abc'],
    ['a host hidden behind userinfo', 'https://fcm.googleapis.com@10.0.0.1/abc'],
    ['not a URL', 'fcm.googleapis.com/fcm/send/abc'],
    ['empty', ''],
  ])('refuses %s', (_name, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe('sendPush', () => {
  type Call = { url: string; init: RequestInit };

  function fakeFetch(status: number, calls: Call[] = []): typeof fetch {
    return (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status });
    }) as typeof fetch;
  }

  it('POSTs the encrypted message with TTL, Urgency, Content-Encoding, and Authorization', async () => {
    const vapid = newVapid();
    const { sub, uaPrivate, authSecret } = newSubscription();
    const calls: Call[] = [];
    expect(await sendPush(sub, '{"handle":"Zed"}', vapid, { fetch: fakeFetch(201, calls) })).toBe('sent');
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0] as Call;
    expect(url).toBe(sub.endpoint);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(headers.get('TTL')).toBe('300');
    expect(headers.get('Urgency')).toBe('high');
    expect(headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(headers.get('Authorization')).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`));
    const body = Buffer.from(init.body as Uint8Array);
    expect(decrypt(body, uaPrivate, authSecret).toString()).toBe('{"handle":"Zed"}\x02');
  });

  it('uses the TTL and Urgency it is given', async () => {
    const calls: Call[] = [];
    await sendPush(newSubscription().sub, 'x', newVapid(), { ttlSeconds: 60, urgency: 'low', fetch: fakeFetch(201, calls) });
    const headers = new Headers((calls[0] as Call).init.headers);
    expect(headers.get('TTL')).toBe('60');
    expect(headers.get('Urgency')).toBe('low');
  });

  it.each([
    [201, 'sent'],
    [202, 'sent'],
    [200, 'failed'],
    [204, 'failed'],
    [301, 'failed'],
    [400, 'failed'],
    [403, 'failed'],
    [404, 'gone'],
    [410, 'gone'],
    [413, 'failed'],
    [429, 'failed'],
    [500, 'failed'],
    [503, 'failed'],
  ] as const)('answers %i with %s', async (status, outcome) => {
    expect(await sendPush(newSubscription().sub, 'x', newVapid(), { fetch: fakeFetch(status) })).toBe(outcome);
  });

  it('refuses an endpoint that is not allowed without sending anything', async () => {
    const calls: Call[] = [];
    for (const endpoint of ['https://10.6.26.1/push', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x']) {
      expect(await sendPush(newSubscription(endpoint).sub, 'x', newVapid(), { fetch: fakeFetch(201, calls) })).toBe('failed');
    }
    expect(calls).toHaveLength(0);
  });

  it('fails without sending for keys that cannot be used', async () => {
    const calls: Call[] = [];
    const { sub } = newSubscription();
    const vapid = newVapid();
    const options = { fetch: fakeFetch(201, calls) };
    expect(await sendPush({ ...sub, p256dh: 'AAAA' }, 'x', vapid, options)).toBe('failed');
    expect(await sendPush({ ...sub, auth: 'AAAA' }, 'x', vapid, options)).toBe('failed');
    // 65 bytes starting 0x04, but not a point on the curve.
    expect(await sendPush({ ...sub, p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url') }, 'x', vapid, options)).toBe('failed');
    expect(await sendPush(sub, 'x'.repeat(MAX_PLAINTEXT_BYTES + 1), vapid, options)).toBe('failed');
    expect(calls).toHaveLength(0);
  });

  it('fails when fetch throws', async () => {
    const throwing = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect(await sendPush(newSubscription().sub, 'x', newVapid(), { fetch: throwing })).toBe('failed');
  });

  // These two run Node's real fetch against a local server. The endpoint passes the allow-list
  // and the injected fetch sends the same request to the local server instead, so no push
  // service is contacted.
  describe('with a local server', () => {
    let server: Server | undefined;
    afterEach(async () => {
      server?.closeAllConnections();
      await new Promise((resolve) => server?.close(resolve));
      server = undefined;
    });

    async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
      server = createServer(handler);
      await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }

    function toLocal(base: string): typeof fetch {
      return ((url: string | URL | Request, init?: RequestInit) => fetch(`${base}${new URL(String(url)).pathname}`, init)) as typeof fetch;
    }

    it('does not follow a redirect', async () => {
      const paths: string[] = [];
      const base = await listen((req, res) => {
        paths.push(req.url ?? '');
        if (req.url === '/target') {
          res.writeHead(201).end();
        } else {
          res.writeHead(307, { Location: '/target' }).end();
        }
      });
      expect(await sendPush(newSubscription().sub, 'x', newVapid(), { fetch: toLocal(base) })).toBe('failed');
      expect(paths).toEqual(['/fcm/send/abc123']);
    });

    it('gives up after the timeout', async () => {
      const base = await listen(() => {
        // Never answers.
      });
      const started = Date.now();
      expect(await sendPush(newSubscription().sub, 'x', newVapid(), { fetch: toLocal(base), timeoutMs: 200 })).toBe('failed');
      expect(Date.now() - started).toBeLessThan(5000);
    });
  });
});
