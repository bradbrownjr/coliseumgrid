import { ThemeProvider } from '@mui/material/styles';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DoneStep } from '../src/pages/signup/DoneStep.tsx';
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
