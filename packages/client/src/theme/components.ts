// Component overrides (docs/DESIGN.md, "Colors" and "Kid-sized targets").
import type { Components, CSSObject, Theme } from '@mui/material/styles';
import './augment.ts';

/** WCAG 2.2 SC 2.5.5: https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html */
const TOUCH_TARGET = 44;
const FOCUS_RING_WIDTH = 3;
const FOCUS_RING_OFFSET = 2;

/**
 * Crimson (primary.main) is 2.95:1 on the dark background, under the 4.5:1 text minimum, so in
 * dark mode red text, outlines, links, icons, and selected states use primary.light.
 * theme.applyStyles scopes the styles to the dark scheme, including the TV route's
 * `mode-dark` wrapper. https://mui.com/material-ui/customization/dark-mode/
 */
const darkRed = (theme: Theme, styles: (red: string) => CSSObject): CSSObject =>
  theme.applyStyles('dark', styles(theme.vars.palette.primary.light));

// The global state classes MUI puts on its components.
const CHECKED = '&.Mui-checked';
const SELECTED = '&.Mui-selected';
// An error keeps its own color: this must not paint over it.
const FOCUSED = '&.Mui-focused:not(.Mui-error)';

export const components: Components<Theme> = {
  // On a phone a dialog keeps a small margin and the width that is left, so a form or the PIN
  // boxes get most of the screen (docs/DESIGN.md, "Phone width").
  MuiDialog: {
    styleOverrides: {
      paper: ({ theme }) => ({
        [theme.breakpoints.down('sm')]: {
          margin: theme.spacing(2),
          '&.MuiDialog-paperFullWidth': { width: `calc(100% - ${theme.spacing(4)})` },
        },
      }),
    },
  },
  // A long handle wraps instead of running out of the dialog.
  MuiDialogTitle: { styleOverrides: { root: { overflowWrap: 'anywhere' } } },
  // MUI drops menu items to their content height from the sm breakpoint up; keep the target.
  MuiMenuItem: {
    styleOverrides: {
      root: ({ theme }) => ({
        minHeight: TOUCH_TARGET,
        [theme.breakpoints.up('sm')]: { minHeight: TOUCH_TARGET },
      }),
    },
  },
  MuiButtonBase: {
    styleOverrides: {
      // Drawn with an outline offset so a strip of page background separates the ring from a
      // filled button.
      root: ({ theme }) => ({
        '&.Mui-focusVisible': {
          outline: `${FOCUS_RING_WIDTH}px solid ${theme.vars.palette.focusRing}`,
          outlineOffset: FOCUS_RING_OFFSET,
          // Above a neighbor's border, as in a toggle button group.
          zIndex: 1,
        },
      }),
    },
  },
  MuiButton: {
    styleOverrides: {
      root: ({ theme, ownerState }) => [
        { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET },
        // Contained buttons keep crimson as a fill, with white text and no extra border.
        ownerState.color === 'primary' && ownerState.variant !== 'contained'
          ? darkRed(theme, (red) => ({
              color: red,
              ...(ownerState.variant === 'outlined' && { borderColor: red }),
            }))
          : null,
      ],
    },
  },
  MuiLink: {
    styleOverrides: {
      root: ({ theme, ownerState }) => [
        {
          '&:focus-visible': {
            outline: `${FOCUS_RING_WIDTH}px solid ${theme.vars.palette.focusRing}`,
            outlineOffset: FOCUS_RING_OFFSET,
          },
        },
        ownerState.color === 'primary'
          ? darkRed(theme, (red) => ({
              color: red,
              '--Link-underlineColor': theme.alpha(red, 0.4),
            }))
          : null,
      ],
    },
  },
  MuiIconButton: {
    styleOverrides: {
      root: ({ theme, ownerState }) => [
        { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET },
        ownerState.color === 'primary' ? darkRed(theme, (red) => ({ color: red })) : null,
      ],
    },
  },
  MuiToggleButton: {
    styleOverrides: {
      root: ({ theme, ownerState }) => [
        { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET },
        // A selected toggle shows primary.light text and border, not a crimson tint alone.
        ownerState.color === 'primary'
          ? darkRed(theme, (red) => ({ [SELECTED]: { color: red, borderColor: red } }))
          : null,
      ],
    },
  },
  MuiTab: {
    styleOverrides: {
      root: ({ theme }) => [
        { minHeight: TOUCH_TARGET },
        darkRed(theme, (red) => ({ [SELECTED]: { color: red } })),
      ],
    },
  },
  MuiTabs: {
    styleOverrides: {
      indicator: ({ theme, ownerState }) =>
        ownerState.indicatorColor === 'primary'
          ? darkRed(theme, (red) => ({ backgroundColor: red }))
          : null,
    },
  },
  MuiCheckbox: {
    styleOverrides: {
      root: ({ theme, ownerState }) => [
        { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET },
        ownerState.color === 'primary'
          ? darkRed(theme, (red) => ({
              [CHECKED]: { color: red },
              '&.MuiCheckbox-indeterminate': { color: red },
            }))
          : null,
      ],
    },
  },
  MuiRadio: {
    styleOverrides: {
      root: ({ theme, ownerState }) => [
        { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET },
        ownerState.color === 'primary' ? darkRed(theme, (red) => ({ [CHECKED]: { color: red } })) : null,
      ],
    },
  },
  MuiSwitch: {
    styleOverrides: {
      switchBase: ({ theme, ownerState }) =>
        ownerState.color === 'primary'
          ? darkRed(theme, (red) => ({
              [CHECKED]: { color: red },
              [`${CHECKED} + .MuiSwitch-track`]: { backgroundColor: red },
            }))
          : null,
    },
  },
  MuiChip: {
    styleOverrides: {
      root: ({ theme, ownerState }) =>
        ownerState.color === 'primary' && ownerState.variant === 'outlined'
          ? darkRed(theme, (red) => ({ color: red, borderColor: theme.alpha(red, 0.7) }))
          : null,
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: ({ theme, ownerState }) =>
        ownerState.color === 'primary'
          ? darkRed(theme, (red) => ({
              [FOCUSED]: { '.MuiOutlinedInput-notchedOutline': { borderColor: red } },
            }))
          : null,
    },
  },
  MuiInputLabel: {
    styleOverrides: {
      // Matched by class: TextField hands `color` to its FormControl, not to the InputLabel, so
      // the label's ownerState has no `color`. FormLabel adds the class from the form context.
      root: ({ theme }) =>
        darkRed(theme, (red) => ({ '&.MuiFormLabel-colorPrimary': { [FOCUSED]: { color: red } } })),
    },
  },
};
