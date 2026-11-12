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
      }),
    ).toEqual({ mode: 'online', host: '127.0.0.1', port: 8080, dataDir: '/data', trustedProxy: '10.0.0.1' });
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
});
