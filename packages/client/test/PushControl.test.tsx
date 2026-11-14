import { ThemeProvider } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PushView } from '../src/pages/phone/PushControl.tsx';
import type { PushState } from '../src/pages/phone/pushClient.ts';
import { theme } from '../src/theme/theme.ts';

const render = (element: ReactElement) => renderToString(<ThemeProvider theme={theme}>{element}</ThemeProvider>);
const view = (state: PushState, extra: { busy?: boolean; words?: string | null } = {}) =>
  render(<PushView state={state} busy={extra.busy ?? false} words={extra.words ?? null} onTurnOn={() => undefined} onTurnOff={() => undefined} />);

describe('the lock screen alerts control', () => {
  it('shows nothing while it checks', () => {
    expect(PushView({ state: 'checking', busy: false, words: null, onTurnOn: () => undefined, onTurnOff: () => undefined })).toBeNull();
  });

  it('offers to turn on when off', () => {
    const html = view('off');
    expect(html).toContain('Turn on lock screen alerts');
    expect(html).toContain('Get an alert even when this page is closed.');
    expect(html).not.toContain('Turn off');
  });

  it('says it is on, with a way to turn off', () => {
    const html = view('on');
    expect(html).toContain('Lock screen alerts are on.');
    expect(html).toContain('Turn off');
    expect(html).not.toContain('Turn on lock screen alerts');
  });

  it('says what to do when the browser blocked it, with no button', () => {
    const html = view('blocked');
    expect(html).toContain('Your browser blocked alerts. Turn them on in its settings.');
    expect(html).not.toContain('<button');
  });

  it('says a browser can not do it', () => {
    const html = view('unsupported');
    expect(html).toContain('can&#x27;t show lock screen alerts');
    expect(html).not.toContain('<button');
  });

  it('tells an iPhone in Safari to use the Home Screen and sign in again', () => {
    const html = view('ios-install');
    expect(html).toContain('Add to Home Screen');
    expect(html).toContain('sign in again');
    expect(html).not.toContain('<button');
  });

  it('disables the button while a change is in progress', () => {
    expect(view('off', { busy: true })).toContain('disabled');
    expect(view('on', { busy: true })).toContain('disabled');
  });

  it('shows words about a try that did not work', () => {
    expect(view('off', { words: "Lock screen alerts aren't on here." })).toContain('Lock screen alerts aren&#x27;t on here.');
  });
});
