import { describe, expect, it } from 'vitest';
import {
  browserCommand,
  candidatePorts,
  dataDirFor,
  hostUrl,
  isColiseumGridHealth,
  planLaunch,
  type PortState,
} from '../src/launch.ts';

describe('dataDirFor', () => {
  it('uses LOCALAPPDATA on Windows', () => {
    expect(dataDirFor('win32', { LOCALAPPDATA: 'C:\\Users\\kid\\AppData\\Local' }, 'C:\\Users\\kid')).toBe(
      'C:\\Users\\kid\\AppData\\Local\\ColiseumGrid',
    );
  });

  it('falls back to AppData\\Local under the profile when LOCALAPPDATA is missing or empty', () => {
    for (const env of [{}, { LOCALAPPDATA: '' }]) {
      expect(dataDirFor('win32', env, 'C:\\Users\\kid')).toBe('C:\\Users\\kid\\AppData\\Local\\ColiseumGrid');
    }
  });

  it('uses ~/.coliseumgrid on Linux, whatever LOCALAPPDATA says', () => {
    expect(dataDirFor('linux', { LOCALAPPDATA: '/nope' }, '/home/kid')).toBe('/home/kid/.coliseumgrid');
  });
});

describe('candidatePorts', () => {
  it('is 3000 and the nine after it', () => {
    expect(candidatePorts()).toEqual([3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009]);
  });
});

describe('planLaunch', () => {
  const probes = (...states: PortState[]) => states.map((state, i) => ({ port: 3000 + i, state }));

  it('starts on 3000 when it is free', () => {
    expect(planLaunch(probes('free', 'free'))).toEqual({ action: 'start', port: 3000, skipped: [] });
  });

  it('moves past ports other programs hold, and says which', () => {
    expect(planLaunch(probes('busy', 'busy', 'free'))).toEqual({ action: 'start', port: 3002, skipped: [3000, 3001] });
  });

  it('opens a running ColiseumGrid instead of starting a second, even after a free port', () => {
    expect(planLaunch(probes('free', 'busy', 'coliseumgrid'))).toEqual({ action: 'open', port: 3002 });
  });

  it('gives up when every port is held by another program', () => {
    expect(planLaunch(probes('busy', 'busy'))).toEqual({ action: 'none' });
    expect(planLaunch([])).toEqual({ action: 'none' });
  });
});

describe('isColiseumGridHealth', () => {
  it('accepts only the ColiseumGrid answer', () => {
    expect(isColiseumGridHealth({ status: 'ok', app: 'coliseumgrid' })).toBe(true);
    // Another app's health check, or an older ColiseumGrid without the field.
    expect(isColiseumGridHealth({ status: 'ok' })).toBe(false);
    expect(isColiseumGridHealth({ status: 'ok', app: 'other' })).toBe(false);
    expect(isColiseumGridHealth({ status: 'down', app: 'coliseumgrid' })).toBe(false);
    expect(isColiseumGridHealth(null)).toBe(false);
    expect(isColiseumGridHealth('ok')).toBe(false);
  });
});

describe('browserCommand', () => {
  it('uses start with an empty title on Windows, and xdg-open on Linux', () => {
    expect(browserCommand('win32', hostUrl(3001))).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/c', 'start', '', 'http://localhost:3001/host'],
    });
    expect(browserCommand('linux', hostUrl(3000))).toEqual({ command: 'xdg-open', args: ['http://localhost:3000/host'] });
  });
});
