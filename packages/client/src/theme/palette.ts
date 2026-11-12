// The palette: the one source of the colors (docs/DESIGN.md, "Colors").
// The theme (./theme.ts) and the contrast check (tools/check-palette.ts) both import it.
// It is a plain object with no imports so Node can load it directly.
//
// Dark mode: primary.light is the text-safe red. The theme overrides MuiButton (text,
// outlined), MuiLink, MuiIconButton, MuiTab (selected text and indicator),
// MuiCheckbox, MuiRadio, and MuiSwitch (checked), MuiChip (outlined), and MuiOutlinedInput
// and MuiInputLabel (focused) to use primary.light in dark mode. primary.main is for
// filled (contained) buttons with a text label only.

export const PALETTE = {
  light: {
    mode: 'light',
    primary: {
      main: '#B80F2A',
      light: '#E03A50',
      dark: '#7F0A1D',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#1C1717',
      light: '#3D3434',
      dark: '#000000',
      contrastText: '#FFFFFF',
    },
    error: {
      main: '#A3166F',
      light: '#C9408F',
      dark: '#700C4C',
      contrastText: '#FFFFFF',
    },
    warning: {
      main: '#A64200',
      light: '#D06018',
      dark: '#7A3000',
      contrastText: '#FFFFFF',
    },
    info: {
      main: '#0B5FB8',
      light: '#3A82D1',
      dark: '#074384',
      contrastText: '#FFFFFF',
    },
    success: {
      main: '#17703A',
      light: '#3E9A5A',
      dark: '#0F5028',
      contrastText: '#FFFFFF',
    },
    background: {
      default: '#F4F0EF',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#1A1414',
      secondary: '#574B4B',
    },
    divider: '#D6CBCA',
    win: {
      main: '#8A6100',
      contrastText: '#FFFFFF',
    },
    loss: {
      main: '#6B6262',
      contrastText: '#FFFFFF',
    },
    upNext: {
      main: '#0B5FB8',
      contrastText: '#FFFFFF',
    },
    focusRing: '#0B5FB8',
  },
  dark: {
    mode: 'dark',
    primary: {
      main: '#B80F2A',
      light: '#FF6060',
      dark: '#8A0A1F',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#EDE6E6',
      light: '#FFFFFF',
      dark: '#BFB5B5',
      contrastText: '#000000',
    },
    error: {
      main: '#FF7AC6',
      light: '#FFA3D8',
      dark: '#E865B3',
      contrastText: '#000000',
    },
    warning: {
      main: '#FF9A3D',
      light: '#FFB870',
      dark: '#D9740F',
      contrastText: '#000000',
    },
    info: {
      main: '#5CB8FF',
      light: '#8FCFFF',
      dark: '#2E8FDB',
      contrastText: '#000000',
    },
    success: {
      main: '#4CD27A',
      light: '#7FE3A0',
      dark: '#26A653',
      contrastText: '#000000',
    },
    background: {
      default: '#0D0A0A',
      paper: '#1C1515',
    },
    text: {
      primary: '#F7F2F2',
      secondary: '#BDB0B0',
    },
    divider: '#3A2F2F',
    win: {
      main: '#FFC93C',
      contrastText: '#000000',
    },
    loss: {
      main: '#8C8282',
      contrastText: '#000000',
    },
    upNext: {
      main: '#5CB8FF',
      contrastText: '#000000',
    },
    focusRing: '#FFC93C',
  },
} as const;

export type Palette = typeof PALETTE;
