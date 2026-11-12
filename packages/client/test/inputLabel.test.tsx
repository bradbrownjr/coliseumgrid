import { renderToString } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import TextField from '@mui/material/TextField';
import { describe, expect, it } from 'vitest';
import { theme } from '../src/theme/theme.ts';

// Rendering for real catches an override that depends on an ownerState field the component
// never sets: the unit tests in theme.test.ts hand the override whatever ownerState they like.
describe('focused TextField label in dark mode', () => {
  const html = renderToString(
    <ThemeProvider theme={theme}>
      <TextField label="Handle" focused />
    </ThemeProvider>,
  );

  it('carries the classes the dark override matches', () => {
    expect(html).toMatch(/<label class="[^"]*MuiFormLabel-colorPrimary[^"]*Mui-focused/);
  });

  it('is colored primary.light under the dark scheme', () => {
    const rule = html.match(/\.mode-dark[^{]*\.MuiFormLabel-colorPrimary\.Mui-focused:not\(\.Mui-error\)[^{]*\{([^}]*)\}/);
    expect(rule?.[1]).toContain('color:var(--mui-palette-primary-light');
  });
});
