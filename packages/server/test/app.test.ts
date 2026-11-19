import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/database.ts';
import { buildApp } from '../src/app.ts';

const INDEX = '<!doctype html><title>ColiseumGrid test page</title>';

describe('without a built client', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ clientDist: join(tmpdir(), 'coliseumgrid-no-such-folder') });
  });
  afterAll(() => app.close());

  // The launcher reads `app` to tell ColiseumGrid from another program on the port.
  it('answers /api/health with exactly { status: "ok", app: "coliseumgrid" }', async () => {
    const res = await app.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toEqual({ status: 'ok', app: 'coliseumgrid' });
    expect(res.body).toBe('{"status":"ok","app":"coliseumgrid"}');
  });

  it('answers an unknown /api path with a JSON 404', async () => {
    const res = await app.inject({ url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toEqual({ error: 'not-found' });
  });

  it('answers a fault with a JSON server-error', async () => {
    const db = openDatabase(':memory:');
    const broken = await buildApp({ db });
    // The prepared statements now fail, which reaches the error handler.
    db.exec('DROP TABLE players');
    const res = await broken.inject({ url: '/api/players' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'server-error' });
    await broken.close();
  });

  it('answers other paths with a JSON 404', async () => {
    const res = await app.inject({ url: '/host' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });
});

describe('with a built client', () => {
  let app: FastifyInstance;
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'coliseumgrid-dist-'));
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), INDEX);
    await writeFile(join(dir, 'assets', 'app.js'), 'export {};');
    app = await buildApp({ clientDist: dir });
  });
  afterAll(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('serves index.html at /', async () => {
    const res = await app.inject({ url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toBe(INDEX);
  });

  it('serves a built file', async () => {
    const res = await app.inject({ url: '/assets/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.body).toBe('export {};');
  });

  it('serves index.html for a client route', async () => {
    const res = await app.inject({ url: '/host/events?tab=1' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toBe(INDEX);
  });

  it('keeps /api/health working', async () => {
    const res = await app.inject({ url: '/api/health' });
    expect(res.json()).toEqual({ status: 'ok', app: 'coliseumgrid' });
  });

  it('answers an unknown /api path with a JSON 404, not the page', async () => {
    for (const url of ['/api/nope', '/api/nope/deeper?x=1', '/api']) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type'], url).toContain('application/json');
      expect(res.body, url).not.toContain('ColiseumGrid test page');
    }
  });

  it('answers HEAD for a client route like GET', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/host' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('answers HEAD for an unknown /api path with a 404', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('does not send the page for a POST to an unknown path', async () => {
    const res = await app.inject({ method: 'POST', url: '/host' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });
});

describe('with a relative clientDist', () => {
  it('resolves it against the working directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coliseumgrid-rel-'));
    await writeFile(join(dir, 'index.html'), INDEX);
    const app = await buildApp({ clientDist: relative(process.cwd(), dir) });
    try {
      const res = await app.inject({ url: '/host' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(INDEX);
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
