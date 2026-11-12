// Types for the custom palette tokens (docs/DEVELOPMENT.md, "Theme"). Each custom color needs
// main, light, dark, and contrastText, and is read in styles as theme.vars.palette.x.
// https://mui.com/material-ui/customization/palette/#custom-colors
import type { PaletteColor, PaletteColorOptions } from '@mui/material/styles';
import type {} from '@mui/material/themeCssVarsAugmentation';

declare module '@mui/material/styles' {
  interface Palette {
    win: PaletteColor;
    loss: PaletteColor;
    upNext: PaletteColor;
    /** The keyboard focus ring: blue in light mode, gold in dark mode. */
    focusRing: string;
  }
  interface PaletteOptions {
    win?: PaletteColorOptions;
    loss?: PaletteColorOptions;
    upNext?: PaletteColorOptions;
    focusRing?: string;
  }
}
