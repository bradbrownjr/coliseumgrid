// The one theme for the three screens (docs/DEVELOPMENT.md, "Theme"). Light and dark live in
// one theme; the default mode is the system setting. The color values are in palette.ts.
import { createTheme, responsiveFontSizes, type PaletteOptions } from '@mui/material/styles';
import { components } from './components.ts';
import { PALETTE, type Palette } from './palette.ts';
import './augment.ts';

type Scheme = Palette['light'] | Palette['dark'];

/** Custom tokens have one color each; the swatch fills the light and dark slots MUI wants. */
const single = (swatch: { main: string; contrastText: string }) => ({
  main: swatch.main,
  light: swatch.main,
  dark: swatch.main,
  contrastText: swatch.contrastText,
});

function schemePalette(p: Scheme): PaletteOptions {
  return {
    primary: p.primary,
    secondary: p.secondary,
    error: p.error,
    warning: p.warning,
    info: p.info,
    success: p.success,
    win: single(p.win),
    loss: single(p.loss),
    upNext: single(p.upNext),
    background: p.background,
    text: p.text,
    divider: p.divider,
    focusRing: p.focusRing,
  };
}

// responsiveFontSizes scales each heading down on narrow screens, so a phone doesn't show
// laptop-sized type (docs/DESIGN.md, "Phone width").
// https://mui.com/material-ui/customization/typography/#responsive-font-sizes
const baseTheme = createTheme({
  cssVariables: {
    // A class, not a media query, so the Display route can force dark with `mode-dark`.
    colorSchemeSelector: '.mode-%s',
  },
  colorSchemes: {
    light: { palette: schemePalette(PALETTE.light) },
    dark: { palette: schemePalette(PALETTE.dark) },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    // Buttons are sentence case (docs/DOC-STYLE.md), not MUI's default capitals.
    button: { textTransform: 'none' },
  },
  components,
});

export const theme = responsiveFontSizes(baseTheme);
