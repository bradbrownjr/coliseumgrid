// The event graphic (docs/PLAN.md, "The event graphic" and "Name tags API"): which uploads are
// taken and which refused, where the file goes and when it is deleted, the serving headers, a
// new event keeping it, and who may upload, remove, and read it. The header parser itself is
// tested in packages/core (image-info.test.ts) with the same fixture files.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventInfo } from '@coliseumgrid/core';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { makeCallers, type Callers } from './bracket-api-helpers.ts';
import { cookieFrom } from './helpers.ts';
import { addPinPlayers, eventually, listen, signInPhone, type Live, type Phone } from './phone-helpers.ts';

const fixture = (name: string): Buffer => readFileSync(new URL(`../../core/test/fixtures/${name}`, import.meta.url));

const LAPTOP = '127.0.0.1';
const STRANGER = '198.51.100.7';

let app: FastifyInstance;
let db: Database;
let dir: string;
let callers: Callers;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'coliseumgrid-graphic-'));
  db = openDatabase(':memory:');
  app = await buildApp({ db, dataDir: dir });
  await app.ready();
  callers = await makeCallers(app);
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const graphicsDir = (): string => join(dir, 'graphics');
const files = (): string[] => (existsSync(graphicsDir()) ? readdirSync(graphicsDir()).sort() : []);

interface Who {
  remoteAddress: string;
  cookie?: string;
}
const laptop: Who = { remoteAddress: LAPTOP };

function upload(body: Buffer | string, type: string | undefined, who: Who = laptop): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'PUT',
    url: '/api/event/graphic',
    remoteAddress: who.remoteAddress,
    payload: body,
    headers: { ...(type !== undefined && { 'content-type': type }), ...(who.cookie && { cookie: who.cookie }) },
  });
}
const fetchGraphic = (who: Who = laptop, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: '/api/event/graphic', remoteAddress: who.remoteAddress, headers: { ...headers, ...(who.cookie && { cookie: who.cookie }) } });
const removeGraphic = (who: Who = laptop) =>
  app.inject({ method: 'DELETE', url: '/api/event/graphic', remoteAddress: who.remoteAddress, ...(who.cookie && { headers: { cookie: who.cookie } }) });
const eventOf = async (): Promise<EventInfo | null> => (await callers.host('GET', '/api/event')).json().event;

/** A copy of `bytes` with `patch` written at `at`. */
function patched(bytes: Buffer, at: number, patch: number[]): Buffer {
  const copy = Buffer.from(bytes);
  copy.set(patch, at);
  return copy;
}
const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

const ACCEPTED = [
  ['graphic.png', 'image/png', 48, 32],
  ['baseline.jpg', 'image/jpeg', 40, 24],
  ['progressive.jpg', 'image/jpeg', 64, 48],
  ['lossy.webp', 'image/webp', 50, 30],
  ['lossless.webp', 'image/webp', 33, 17],
  ['extended.webp', 'image/webp', 70, 20],
] as const;

describe('PUT /api/event/graphic takes', () => {
  it.each(ACCEPTED)('%s as %s, %i x %i, and serves it back as it was', async (name, type, width, height) => {
    const bytes = fixture(name);
    const res = await upload(bytes, type);
    expect(res.statusCode, res.body).toBe(200);
    const { event } = res.json();
    expect(event).toEqual({ name: 'ColiseumGrid', game: null, graphic: { width, height, version: expect.any(String) } });
    expect(Object.keys(event.graphic).sort()).toEqual(['height', 'version', 'width']);

    const served = await fetchGraphic();
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe(type);
    expect(served.rawPayload.equals(bytes)).toBe(true);
  });

  it('a Content-Type with parameters or in capitals', async () => {
    expect((await upload(fixture('graphic.png'), 'IMAGE/PNG; charset=binary')).statusCode).toBe(200);
  });

  it('16 and 4000 pixels, the ends of the range', async () => {
    const png = fixture('graphic.png');
    expect((await upload(patched(png, 16, be32(16)), 'image/png')).json().event.graphic).toMatchObject({ width: 16 });
    expect((await upload(patched(png, 20, be32(4000)), 'image/png')).json().event.graphic).toMatchObject({ height: 4000 });
  });

  it('a file of exactly 2 MB', async () => {
    // A PNG with a padding chunk that brings it to the limit.
    const png = fixture('graphic.png');
    const iend = png.length - 12;
    const padLength = 2 * 1024 * 1024 - png.length - 12;
    const pad = Buffer.concat([Buffer.from(be32(padLength)), Buffer.from('teXt'), Buffer.alloc(padLength), Buffer.alloc(4)]);
    const big = Buffer.concat([png.subarray(0, iend), pad, png.subarray(iend)]);
    expect(big.length).toBe(2 * 1024 * 1024);
    expect((await upload(big, 'image/png')).statusCode).toBe(200);
  });
});

describe('PUT /api/event/graphic refuses', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script></svg>';

  async function refused(res: LightMyRequestResponse, status: number, error: string): Promise<void> {
    expect(res.statusCode, res.body).toBe(status);
    expect(res.json()).toEqual({ error });
    // Nothing was stored and no file was left behind.
    expect((await eventOf())?.graphic ?? null).toBeNull();
    expect(files()).toEqual([]);
  }

  it('an SVG, as 415 bad-type', async () => {
    await refused(await upload(svg, 'image/svg+xml'), 415, 'bad-type');
  });

  it('any other type: GIF, text, JSON, form data, or none', async () => {
    await refused(await upload(Buffer.from('GIF89a'), 'image/gif'), 415, 'bad-type');
    await refused(await upload('hello', 'text/plain'), 415, 'bad-type');
    await refused(await upload(JSON.stringify({ image: 'x' }), 'application/json'), 415, 'bad-type');
    await refused(await upload('a=b', 'application/x-www-form-urlencoded'), 415, 'bad-type');
    await refused(await upload(fixture('graphic.png'), undefined), 415, 'bad-type');
  });

  it('an SVG, or a file of another type, sent as PNG, JPEG, or WebP: 400 bad-image', async () => {
    await refused(await upload(svg, 'image/png'), 400, 'bad-image');
    await refused(await upload(fixture('graphic.png'), 'image/jpeg'), 400, 'bad-image');
    await refused(await upload(fixture('baseline.jpg'), 'image/webp'), 400, 'bad-image');
    await refused(await upload(fixture('lossy.webp'), 'image/png'), 400, 'bad-image');
  });

  it('a cut-off header, and an empty body', async () => {
    await refused(await upload(fixture('graphic.png').subarray(0, 20), 'image/png'), 400, 'bad-image');
    await refused(await upload(fixture('progressive.jpg').subarray(0, 100), 'image/jpeg'), 400, 'bad-image');
    await refused(await upload(fixture('extended.webp').subarray(0, 25), 'image/webp'), 400, 'bad-image');
    await refused(await upload(Buffer.alloc(0), 'image/png'), 400, 'bad-image');
  });

  it.each([15, 4001])('a width or a height of %i pixels: 400 bad-size', async (n) => {
    const png = fixture('graphic.png');
    await refused(await upload(patched(png, 16, be32(n)), 'image/png'), 400, 'bad-size');
    await refused(await upload(patched(png, 20, be32(n)), 'image/png'), 400, 'bad-size');
  });

  it('a width or a height of 0 is not a readable image: 400 bad-image', async () => {
    // The PNG spec calls zero invalid, so imageInfo refuses the header before any size check.
    const png = fixture('graphic.png');
    await refused(await upload(patched(png, 16, be32(0)), 'image/png'), 400, 'bad-image');
    await refused(await upload(patched(png, 20, be32(0)), 'image/png'), 400, 'bad-image');
  });

  it('a file over 2 MB, as 413 too-large', async () => {
    const big = Buffer.concat([fixture('graphic.png'), Buffer.alloc(2 * 1024 * 1024)]);
    await refused(await upload(big, 'image/png'), 413, 'too-large');
  });

  it('a body over 2 MB that says it is smaller', async () => {
    // Fastify counts the bytes as they arrive, whatever Content-Length said.
    const big = Buffer.concat([fixture('graphic.png'), Buffer.alloc(2 * 1024 * 1024)]);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/event/graphic',
      remoteAddress: LAPTOP,
      payload: big,
      headers: { 'content-type': 'image/png', 'transfer-encoding': 'chunked' },
    });
    expect(res.statusCode).toBe(413);
  });
});

describe('the raw body parser belongs to the upload only', () => {
  it('another route still refuses an image body', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/event',
      remoteAddress: LAPTOP,
      payload: fixture('graphic.png'),
      headers: { 'content-type': 'image/png' },
    });
    expect(res.statusCode).toBe(415);
    expect(await eventOf()).toBeNull();
  });

  it('another route keeps its own answer to a large body', async () => {
    const res = await callers.host('PUT', '/api/event', { name: 'x'.repeat(1024 * 1024 + 10) });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });
});

describe('the stored file', () => {
  it('goes in DATA_DIR/graphics under a random name of the server\'s', async () => {
    const res = await upload(fixture('graphic.png'), 'image/png');
    const { version } = res.json().event.graphic;
    expect(files()).toEqual([version]);
    expect(version).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readFileSync(join(graphicsDir(), version)).equals(fixture('graphic.png'))).toBe(true);
    // A second upload of the same bytes gets a new name, so the page loads it again.
    const again = (await upload(fixture('graphic.png'), 'image/png')).json().event.graphic.version;
    expect(again).not.toBe(version);
  });

  it('is deleted when replaced or removed, once no event uses it', async () => {
    const first = (await upload(fixture('graphic.png'), 'image/png')).json().event.graphic.version as string;
    const second = (await upload(fixture('lossy.webp'), 'image/webp')).json().event.graphic.version as string;
    expect(files()).toEqual([second]);
    const res = await removeGraphic();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ event: { name: 'ColiseumGrid', game: null, graphic: null } });
    expect(files()).toEqual([]);
    expect(first).not.toBe(second);
  });

  it('leaves one file when two uploads arrive at once', async () => {
    const answers = await Promise.all([upload(fixture('graphic.png'), 'image/png'), upload(fixture('lossy.webp'), 'image/webp')]);
    expect(answers.map((r) => r.statusCode)).toEqual([200, 200]);
    const current = (await eventOf())?.graphic?.version;
    expect(files()).toEqual([current]);
  });

  // Only the current event's graphic is ever shown (docs/PLAN.md, "Storing"), so a past event
  // that names the file doesn't keep it.
  it('is deleted when replaced or removed even though an earlier event names it, and that event forgets it', async () => {
    const first = (await upload(fixture('graphic.png'), 'image/png')).json().event.graphic.version as string;
    expect((await callers.host('POST', '/api/events', { name: 'Saturday' })).statusCode).toBe(201);
    const second = (await upload(fixture('lossy.webp'), 'image/webp')).json().event.graphic.version as string;
    expect(files()).toEqual([second]);
    expect(db.prepare('SELECT graphic_file, graphic_type, graphic_width, graphic_height FROM events WHERE id = 1').get()).toEqual({
      graphic_file: null,
      graphic_type: null,
      graphic_width: null,
      graphic_height: null,
    });
    await removeGraphic();
    expect(files()).toEqual([]);
    expect(first).not.toBe(second);
  });

  it('is kept while the current event uses it, whatever a past event does', async () => {
    await upload(fixture('graphic.png'), 'image/png');
    await callers.host('POST', '/api/events', { name: 'Saturday' });
    // Nothing changed the graphic, so both events still name the file.
    expect(files()).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM events WHERE graphic_file IS NOT NULL').get()).toEqual({ n: 2 });
  });

  it('is deleted when the database refuses the new graphic, and the old one stays', async () => {
    const first = (await upload(fixture('graphic.png'), 'image/png')).json().event.graphic.version as string;
    db.exec("CREATE TRIGGER refuse BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'refused'); END");
    expect((await upload(fixture('lossy.webp'), 'image/webp')).statusCode).toBe(500);
    expect(files()).toEqual([first]);
  });

  it('is deleted when it can not be written', async (context) => {
    // A folder nobody can write to; root ignores the permission, so the check is skipped for it.
    if (process.getuid?.() === 0) return context.skip();
    await mkdir(graphicsDir(), { recursive: true });
    await chmod(graphicsDir(), 0o500);
    try {
      expect((await upload(fixture('graphic.png'), 'image/png')).statusCode).toBe(500);
    } finally {
      await chmod(graphicsDir(), 0o700);
    }
    expect(files()).toEqual([]);
    expect(await eventOf()).toBeNull();
  });

  it('removing when there is no graphic, or no event, changes nothing', async () => {
    expect((await removeGraphic()).json()).toEqual({ event: null });
    expect(await eventOf()).toBeNull();
    await callers.host('PUT', '/api/event', { name: 'Friday' });
    expect((await removeGraphic()).json()).toEqual({ event: { name: 'Friday', game: null, graphic: null } });
  });
});

describe('files nothing names, at startup', () => {
  const TOKEN_A = 'A'.repeat(43);

  /** A server on the same folder and database, as after a restart. */
  async function restart(): Promise<void> {
    await app.close();
    db = openDatabase(':memory:');
    app = await buildApp({ db, dataDir: dir });
    await app.ready();
  }

  it('deletes a file of the server\'s own kind that no event names, and keeps the ones an event names', async () => {
    const { version } = (await upload(fixture('graphic.png'), 'image/png')).json().event.graphic as { version: string };
    await writeFile(join(graphicsDir(), TOKEN_A), 'orphan');
    // The app closed the database it was given, so the restart is a new one that still names the file.
    await app.close();
    db = openDatabase(':memory:');
    db.prepare("INSERT INTO events (name, created_at, graphic_file, graphic_type, graphic_width, graphic_height) VALUES ('Friday', 't', ?, 'image/png', 48, 32)").run(version);
    app = await buildApp({ db, dataDir: dir });
    await app.ready();
    expect(files()).toEqual([version]);
  });

  it('leaves a file whose name is not one the server makes', async () => {
    await mkdir(graphicsDir(), { recursive: true });
    for (const name of ['notes.txt', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}.`]) await writeFile(join(graphicsDir(), name), 'mine');
    await restart();
    expect(files()).toHaveLength(4);
  });

  it('is fine with no folder yet', async () => {
    await restart();
    expect(files()).toEqual([]);
  });
});

describe('a new event', () => {
  it('keeps the graphic, and serves the same file', async () => {
    const graphic = (await upload(fixture('graphic.png'), 'image/png')).json().event.graphic;
    const res = await callers.host('POST', '/api/events', { name: 'Saturday' });
    expect(res.json()).toEqual({ event: { name: 'Saturday', game: null, graphic } });
    expect(await eventOf()).toEqual({ name: 'Saturday', game: null, graphic });
    expect((await fetchGraphic()).rawPayload.equals(fixture('graphic.png'))).toBe(true);
  });

  it('keeps the graphic through a rename', async () => {
    const graphic = (await upload(fixture('graphic.png'), 'image/png')).json().event.graphic;
    expect((await callers.host('PUT', '/api/event', { name: 'Renamed' })).json()).toEqual({ event: { name: 'Renamed', game: null, graphic } });
  });
});

describe('GET /api/event/graphic', () => {
  it('answers 404 not-found when there is none', async () => {
    const res = await fetchGraphic();
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not-found' });
  });

  it('serves the stored type with nosniff, the sandbox policy, and the version as its ETag', async () => {
    const { version } = (await upload(fixture('lossless.webp'), 'image/webp')).json().event.graphic;
    const res = await fetchGraphic();
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(res.headers['etag']).toBe(`"${version}"`);
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');

    const again = await fetchGraphic(laptop, { 'if-none-match': `"${version}"` });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    expect(again.headers['x-content-type-options']).toBe('nosniff');
    expect((await fetchGraphic(laptop, { 'if-none-match': '"old"' })).statusCode).toBe(200);
  });

  it('answers 404 when the file is missing from the folder', async () => {
    const { version } = (await upload(fixture('graphic.png'), 'image/png')).json().event.graphic;
    await rm(join(graphicsDir(), version));
    expect((await fetchGraphic()).statusCode).toBe(404);
  });
});

describe('who may use the graphic', () => {
  let phone: Phone;
  let display: Who;
  let signup: Who;
  beforeEach(async () => {
    addPinPlayers(db, 1);
    phone = await signInPhone(app, 'Player1');
    const pair = async (role: 'display' | 'signup'): Promise<Who> => {
      const code = (await callers.host('POST', '/api/pairing/codes', { role })).json().code as string;
      const joined = await app.inject({ method: 'POST', url: '/api/devices/join', payload: { code }, remoteAddress: STRANGER });
      return { remoteAddress: STRANGER, cookie: cookieFrom(joined) };
    };
    display = await pair('display');
    signup = await pair('signup');
  });

  it('refuses the upload and the removal to a phone, a Sign-up device, a Display, and a stranger', async () => {
    const stored = (await upload(fixture('graphic.png'), 'image/png')).json().event.graphic;
    const callersOf: Array<[string, Who]> = [
      ['phone', { remoteAddress: '198.51.100.20', cookie: phone.cookie }],
      ['signup', signup],
      ['display', display],
      ['stranger', { remoteAddress: STRANGER }],
    ];
    for (const [name, who] of callersOf) {
      for (const res of [await upload(fixture('lossy.webp'), 'image/webp', who), await removeGraphic(who)]) {
        expect(res.statusCode, name).toBe(401);
        expect(res.json()).toEqual({ error: 'not-signed-in' });
      }
    }
    expect((await eventOf())?.graphic).toEqual(stored);
    expect(files()).toEqual([stored.version]);
  });

  it('refuses an oversized upload from a stranger with 401 before reading the body', async () => {
    const big = Buffer.concat([fixture('graphic.png'), Buffer.alloc(3 * 1024 * 1024)]);
    expect((await upload(big, 'image/png', { remoteAddress: STRANGER })).statusCode).toBe(401);
  });

  it('serves the file to the host, a Display, and a Sign-up device, and not to a phone or a stranger', async () => {
    await upload(fixture('graphic.png'), 'image/png');
    for (const who of [laptop, display, signup]) expect((await fetchGraphic(who)).statusCode).toBe(200);
    for (const who of [{ remoteAddress: '198.51.100.20', cookie: phone.cookie }, { remoteAddress: STRANGER }]) {
      const res = await fetchGraphic(who);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'not-signed-in' });
    }
  });

  it('a phone still reads the event with its graphic size', async () => {
    const { graphic } = (await upload(fixture('graphic.png'), 'image/png')).json().event;
    expect((await phone.api('GET', '/api/event')).json()).toEqual({ event: { name: 'ColiseumGrid', game: null, graphic } });
  });
});

describe('the event live message', () => {
  const open: Live[] = [];
  afterEach(() => {
    for (const live of open.splice(0)) live.terminate();
  });

  it('goes to every screen when the graphic is uploaded or removed', async () => {
    const code = (await callers.host('POST', '/api/pairing/codes', { role: 'display' })).json().code as string;
    const cookie = cookieFrom(await app.inject({ method: 'POST', url: '/api/devices/join', payload: { code }, remoteAddress: STRANGER }));
    const live = await listen(app, cookie, STRANGER);
    open.push(live);
    const { graphic } = (await upload(fixture('graphic.png'), 'image/png')).json().event;
    await eventually(() => expect(live.messages).toEqual([{ type: 'event', event: { name: 'ColiseumGrid', game: null, graphic } }]));
    await removeGraphic();
    await eventually(() => expect(live.messages).toHaveLength(2));
    expect(live.messages[1]).toEqual({ type: 'event', event: { name: 'ColiseumGrid', game: null, graphic: null } });
    // A refused upload sends nothing.
    await upload('<svg/>', 'image/svg+xml');
    await removeGraphic();
    await callers.host('PUT', '/api/event', { name: 'Marker' });
    await eventually(() => expect(live.messages).toHaveLength(3));
    expect(live.messages[2]).toMatchObject({ type: 'event', event: { name: 'Marker' } });
  });
});
