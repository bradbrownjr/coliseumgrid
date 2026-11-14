import { ThemeProvider } from '@mui/material/styles';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DONE_QR_SECONDS, DONE_SECONDS, DoneStep } from '../src/pages/signup/DoneStep.tsx';
import { theme } from '../src/theme/theme.ts';

const render = (pin?: string) =>
  renderToString(
    <ThemeProvider theme={theme}>
      <DoneStep handle="Zap" {...(pin !== undefined && { pin })} onNext={() => undefined} />
    </ThemeProvider>,
  );

describe('the done screen', () => {
  it('shows the PIN of a new sign-up', () => {
    const html = render('4321');
    expect(html).toContain('Your PIN');
    expect(html).toContain('PIN 4 3 2 1');
  });

  it('shows no PIN when none is passed (a returning player)', () => {
    const html = render();
    expect(html).toContain('You&#x27;re in, Zap!');
    expect(html).not.toContain('Your PIN');
    expect(html).not.toContain('aria-label="PIN');
  });
});

describe('the done screen with a QR code', () => {
  const renderWith = (followUrl: string | null) =>
    renderToString(
      <ThemeProvider theme={theme}>
        <DoneStep handle="Zap" followUrl={followUrl} onNext={() => undefined} />
      </ThemeProvider>,
    );

  it('shows the code and the words under it', () => {
    const html = renderWith('http://10.6.26.20:8080/follow?code=K7M4QX');
    expect(html).toContain('Scan with your phone to follow your matches');
    expect(html).toContain('QR code that opens the player page on your phone');
  });

  it('shows no code when there is no address a phone can reach', () => {
    expect(renderWith(null)).not.toContain('Scan with your phone');
    expect(render('4321')).not.toContain('Scan with your phone');
  });

  it('stays 30 seconds with a code and 15 without', () => {
    expect(DONE_QR_SECONDS).toBe(30);
    expect(DONE_SECONDS).toBe(15);
  });
});
