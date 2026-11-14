import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('uses the defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({ mode: 'offline', host: '0.0.0.0', port: 3000, dataDir: resolve('data') });
  });

  it('reads every setting', () => {
    expect(
      loadConfig({
        COLISEUMGRID_MODE: 'online',
        HOST: '127.0.0.1',
        PORT: '8080',
        DATA_DIR: '/data',
        TRUSTED_PROXY: '10.0.0.1',
        COLISEUMGRID_HOST_PASSWORD: 'hunter2hunter2',
      }),
    ).toEqual({
      mode: 'online',
      host: '127.0.0.1',
      port: 8080,
      dataDir: '/data',
      trustedProxy: '10.0.0.1',
      hostPassword: 'hunter2hunter2',
    });
  });

  it('takes the host password as it is, spaces included', () => {
    expect(loadConfig({ COLISEUMGRID_HOST_PASSWORD: '  spaced out  ' }).hostPassword).toBe('  spaced out  ');
  });

  it('treats an empty host password as not set', () => {
    expect(loadConfig({ COLISEUMGRID_HOST_PASSWORD: '' })).not.toHaveProperty('hostPassword');
  });

  it('refuses to start online without a host password', () => {
    expect(() => loadConfig({ COLISEUMGRID_MODE: 'online' })).toThrow(/COLISEUMGRID_HOST_PASSWORD/);
    expect(() => loadConfig({ COLISEUMGRID_MODE: 'online', COLISEUMGRID_HOST_PASSWORD: '' })).toThrow(
      /COLISEUMGRID_HOST_PASSWORD/,
    );
  });

  it('starts offline without a host password, for first-run setup from localhost', () => {
    expect(loadConfig({ COLISEUMGRID_MODE: 'offline' }).mode).toBe('offline');
  });

  it.each(['short', 'x'.repeat(129)])('fails on a host password of the wrong length, without printing it', (password) => {
    try {
      loadConfig({ COLISEUMGRID_HOST_PASSWORD: password });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toMatch(/COLISEUMGRID_HOST_PASSWORD must be 8 to 128/);
      expect((error as Error).message).not.toContain(password);
    }
  });

  it('resolves a relative DATA_DIR against the working directory', () => {
    expect(loadConfig({ DATA_DIR: 'somewhere/db' }).dataDir).toBe(resolve('somewhere/db'));
  });

  it('writes an IPv4-mapped TRUSTED_PROXY as plain IPv4 and accepts IPv6', () => {
    expect(loadConfig({ TRUSTED_PROXY: '::ffff:10.0.0.1' }).trustedProxy).toBe('10.0.0.1');
    expect(loadConfig({ TRUSTED_PROXY: '::1' }).trustedProxy).toBe('::1');
  });

  it.each(['proxy.example.com', '10.0.0', '10.0.0.1, 10.0.0.2'])('fails on the TRUSTED_PROXY "%s"', (value) => {
    expect(() => loadConfig({ TRUSTED_PROXY: value })).toThrow(/TRUSTED_PROXY/);
  });

  it('fails on an unknown mode', () => {
    expect(() => loadConfig({ COLISEUMGRID_MODE: 'Online' })).toThrow(/COLISEUMGRID_MODE/);
    expect(() => loadConfig({ COLISEUMGRID_MODE: '' })).toThrow(/COLISEUMGRID_MODE/);
  });

  it.each(['abc', '-1', '1.5', '65536', '', '3000 '])('fails on the port "%s"', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT/);
  });

  describe('COLISEUMGRID_PUSH_SUBJECT', () => {
    it('is not set by default, and an empty value counts as not set', () => {
      expect(loadConfig({})).not.toHaveProperty('pushSubject');
      expect(loadConfig({ COLISEUMGRID_PUSH_SUBJECT: '' })).not.toHaveProperty('pushSubject');
    });

    it.each(['mailto:host@example.com', 'https://games.example.com', 'https://games.example.com/contact'])('accepts "%s"', (subject) => {
      expect(loadConfig({ COLISEUMGRID_PUSH_SUBJECT: subject }).pushSubject).toBe(subject);
    });

    it.each([
      'host@example.com',
      'mailto:',
      'mailto:host',
      'mailto:host@localhost',
      'http://games.example.com',
      'https://localhost',
      'https://localhost:3000/x',
      'https://127.0.0.1',
      'https://[::1]',
      'https://app.localhost',
      'https://user:pw@games.example.com',
      'games.example.com',
      'ftp://games.example.com',
    ])('fails on "%s"', (subject) => {
      expect(() => loadConfig({ COLISEUMGRID_PUSH_SUBJECT: subject })).toThrow(/COLISEUMGRID_PUSH_SUBJECT/);
    });
  });
});
