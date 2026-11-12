import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('uses the defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({ mode: 'offline', host: '0.0.0.0', port: 3000 });
  });

  it('reads every setting', () => {
    expect(loadConfig({ COLISEUMGRID_MODE: 'online', HOST: '127.0.0.1', PORT: '8080' })).toEqual({
      mode: 'online',
      host: '127.0.0.1',
      port: 8080,
    });
  });

  it('fails on an unknown mode', () => {
    expect(() => loadConfig({ COLISEUMGRID_MODE: 'Online' })).toThrow(/COLISEUMGRID_MODE/);
    expect(() => loadConfig({ COLISEUMGRID_MODE: '' })).toThrow(/COLISEUMGRID_MODE/);
  });

  it.each(['abc', '-1', '1.5', '65536', '', '3000 '])('fails on the port "%s"', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT/);
  });
});
