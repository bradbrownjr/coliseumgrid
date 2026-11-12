import { describe, expect, it } from 'vitest';
import { PALETTE } from '../src/theme/palette.ts';
import { theme } from '../src/theme/theme.ts';

const SCHEMES = ['light', 'dark'] as const;
const COLORS = ['primary', 'secondary', 'error', 'warning', 'info', 'success', 'win', 'loss', 'upNext'] as const;
const HEX = /^#[0-9A-F]{6}$/;

describe('palette', () => {
  it.each(SCHEMES)('%s: every color sets contrastText', (scheme) => {
    for (const color of COLORS) {
      expect(PALETTE[scheme][color].contrastText, `${scheme} ${color}`).toMatch(HEX);
    }
  });

  it.each(SCHEMES)('%s: the theme carries the palette contrastText, never one MUI computed', (scheme) => {
    const palette = theme.colorSchemes[scheme]?.palette;
    expect(palette).toBeDefined();
    for (const color of COLORS) {
      expect(palette?.[color].contrastText, `${scheme} ${color}`).toBe(PALETTE[scheme][color].contrastText);
    }
  });

  it('keeps crimson as primary.main in both schemes', () => {
    expect(PALETTE.light.primary.main).toBe('#B80F2A');
    expect(PALETTE.dark.primary.main).toBe('#B80F2A');
  });

  it('has a focus ring in both schemes', () => {
    expect(theme.colorSchemes.light?.palette.focusRing).toBe(PALETTE.light.focusRing);
    expect(theme.colorSchemes.dark?.palette.focusRing).toBe(PALETTE.dark.focusRing);
  });
});

describe('theme', () => {
  it('switches schemes with a class, so the TV route can force dark', () => {
    expect(theme.defaultColorScheme).toBe('light');
    expect(JSON.stringify(theme.applyStyles('dark', { color: 'red' }))).toContain('mode-dark');
  });
});

type Fn = (args: { theme: typeof theme; ownerState: Record<string, unknown> }) => unknown;

/** The dark-mode overrides DESIGN.md, "Colors" lists: [component, slot, props the override needs]. */
const DARK_RED: ReadonlyArray<[string, string, Record<string, unknown>]> = [
  ['MuiButton', 'root', { color: 'primary', variant: 'text' }],
  ['MuiButton', 'root', { color: 'primary', variant: 'outlined' }],
  ['MuiLink', 'root', { color: 'primary' }],
  ['MuiIconButton', 'root', { color: 'primary' }],
  ['MuiToggleButton', 'root', { color: 'primary' }],
  ['MuiTab', 'root', {}],
  ['MuiTabs', 'indicator', { indicatorColor: 'primary' }],
  ['MuiCheckbox', 'root', { color: 'primary' }],
  ['MuiRadio', 'root', { color: 'primary' }],
  ['MuiSwitch', 'switchBase', { color: 'primary' }],
  ['MuiChip', 'root', { color: 'primary', variant: 'outlined' }],
  ['MuiOutlinedInput', 'root', { color: 'primary' }],
  ['MuiInputLabel', 'root', { color: 'primary' }],
];

function darkStyles(component: string, slot: string, ownerState: Record<string, unknown>): string {
  const overrides = (theme.components as Record<string, { styleOverrides?: Record<string, Fn> }> | undefined)?.[component]
    ?.styleOverrides?.[slot];
  expect(overrides, `${component}.${slot}`).toBeTypeOf('function');
  const result = (overrides as Fn)({ theme, ownerState });
  // Keep only the part scoped to the dark scheme.
  const dark = (Array.isArray(result) ? result : [result])
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .flatMap((entry) => Object.entries(entry).filter(([selector]) => selector.includes('mode-dark')));
  return JSON.stringify(dark);
}

describe('dark-mode overrides', () => {
  it.each(DARK_RED)('%s %s uses primary.light and never primary.main', (component, slot, ownerState) => {
    const css = darkStyles(component, slot, ownerState);
    expect(css).toContain('var(--mui-palette-primary-light');
    expect(css).not.toContain('primary-main');
  });

  it('leaves contained buttons without dark overrides', () => {
    expect(darkStyles('MuiButton', 'root', { color: 'primary', variant: 'contained' })).toBe('[]');
  });

  it('leaves other button colors alone', () => {
    expect(darkStyles('MuiButton', 'root', { color: 'secondary', variant: 'text' })).toBe('[]');
  });
});

describe('touch targets', () => {
  it.each(['MuiButton', 'MuiIconButton', 'MuiToggleButton', 'MuiCheckbox', 'MuiRadio'])(
    '%s is at least 44px',
    (component) => {
      const overrides = (theme.components as Record<string, { styleOverrides?: { root?: Fn } }> | undefined)?.[component]
        ?.styleOverrides?.root;
      const result = (overrides as Fn)({ theme, ownerState: { color: 'primary', variant: 'text' } });
      expect(JSON.stringify(result)).toContain('"minHeight":44');
      expect(JSON.stringify(result)).toContain('"minWidth":44');
    },
  );
});
