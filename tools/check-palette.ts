// Palette contrast check for ColiseumGrid. Reads packages/client/src/theme/palette.ts; exits 1 on any failing row.
// Usage: node tools/check-palette.ts (rules: docs/DESIGN.md, "Colors")
// Contrast: WCAG 2.2 relative luminance and contrast ratio
//   https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
//   https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
// Thresholds: SC 1.4.3 text 4.5:1 https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
//             SC 1.4.11 non-text 3:1 https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
// CVD simulation: Machado, Oliveira, Fernandes 2009, severity 1.0 matrices (Table 1)
//   https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
//   applied in linear RGB, as DaltonLens does: https://daltonlens.org/opensource-cvd-simulation/
// Hue separation: CIE76 delta E in CIELAB (D65)
//   http://brucelindbloom.com/index.html?Eqn_DeltaE_CIE76.html
import process from 'node:process';
import { PALETTE } from '../packages/client/src/theme/palette.ts';
type Rgb = [number, number, number];
type Matrix = readonly [Rgb, Rgb, Rgb];
interface Swatch {
  main: string;
  dark?: string;
  contrastText: string;
}
const GROUPS = ['primary', 'secondary', 'error', 'warning', 'info', 'success', 'win', 'loss', 'upNext'] as const;
interface Scheme extends Record<(typeof GROUPS)[number], Swatch> {
  primary: Swatch & { light: string };
  background: { default: string; paper: string };
  text: { primary: string; secondary: string };
  focusRing: string;
}
const P: Record<'light' | 'dark', Scheme> = PALETTE;

// Color-vision simulations; null means no simulation.
const M: Record<'normal' | 'protan' | 'deutan', Matrix | null> = {
  normal: null,
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
};
type Sim = keyof typeof M;
const SIMS = Object.keys(M) as Sim[];
const hex2 = (h: string): Rgb => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const lin = (h: string, sim: Sim): Rgb => {
  const l = hex2(h).map(toLin) as Rgb;
  const m = M[sim];
  if (!m) return l;
  return m.map(r => clamp(r[0] * l[0] + r[1] * l[1] + r[2] * l[2])) as Rgb;
};
const lum = (l: Rgb) => 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
const ratio = (a: string, b: string, sim: Sim) => {
  const [x, y] = [lum(lin(a, sim)), lum(lin(b, sim))].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
const lab = (l: Rgb): Rgb => {
  const X = (0.4124 * l[0] + 0.3576 * l[1] + 0.1805 * l[2]) / 0.95047;
  const Y = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  const Z = (0.0193 * l[0] + 0.1192 * l[1] + 0.9505 * l[2]) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
const dE = (a: string, b: string, sim: Sim) => {
  const [p, q] = [lab(lin(a, sim)), lab(lin(b, sim))];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
let fails = 0;
const out: string[] = [];
// info = true: reported but not a requirement (see the note at the call site).
const row = (mode: string, label: string, fg: string, bg: string, min: number, info = false) => {
  const r = SIMS.map(s => ratio(fg, bg, s));
  const ok = r.map(x => (x >= min ? 'ok' : info ? 'info' : 'FAIL'));
  if (ok.includes('FAIL')) fails++;
  out.push(`${mode.padEnd(5)} ${label.padEnd(44)} ${fg} on ${bg}  min ${min}  ` +
    r.map((x, i) => `${SIMS[i]} ${x.toFixed(2).padStart(5)} ${(ok[i] ?? '').padEnd(4)}`).join('  '));
};

for (const mode of ['light', 'dark'] as const) {
  const p = P[mode];
  const bgs = [['default', p.background.default], ['paper', p.background.paper]] as const;
  out.push(`\n== ${mode} ==`);
  for (const [n, bg] of bgs) {
    row(mode, `text.primary / bg.${n}`, p.text.primary, bg, 4.5);
    row(mode, `text.secondary / bg.${n}`, p.text.secondary, bg, 4.5);
  }
  for (const k of GROUPS) {
    row(mode, `${k}.contrastText / ${k}.main`, p[k].contrastText, p[k].main, 4.5);
    for (const [n, bg] of bgs) {
      // Dark-mode crimson is only a fill behind a text label. Understanding 1.4.11 says a
      // control identified by its text needs no 3:1 boundary, so this row is informational,
      // and red text uses primary.light instead.
      // https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
      const fillOnly = mode === 'dark' && k === 'primary';
      // A filled control or status chip has to stand out from the page (1.4.11).
      row(mode, `${k}.main fill / bg.${n}`, p[k].main, bg, 3, fillOnly);
      // The same color used as text (outlined button label, status word, heading).
      row(mode, `${k}.main as text / bg.${n}`, p[k].main, bg, 4.5, fillOnly);
      if (fillOnly) {
        row(mode, `primary.light (text-safe red) / bg.${n}`, p.primary.light, bg, 4.5);
      }
    }
    if (p[k].dark) row(mode, `${k}.contrastText / ${k}.dark (hover)`, p[k].contrastText, p[k].dark, 4.5);
  }
  for (const [n, bg] of bgs) row(mode, `focusRing / bg.${n}`, p.focusRing, bg, 3);
  // The ring is drawn with outline-offset so a strip of page background separates it from a
  // filled button; the ring is then judged against the background only.
  if (mode === 'dark') out.push(`${mode.padEnd(5)} delta E76 primary.light vs error: ` +
    SIMS.map(s => `${s} ${dE(p.primary.light, p.error.main, s).toFixed(1)}`).join('  '));
  out.push(`${mode.padEnd(5)} delta E76 primary vs error:   ` +
    SIMS.map(s => `${s} ${dE(p.primary.main, p.error.main, s).toFixed(1)}`).join('  '));
  out.push(`${mode.padEnd(5)} delta E76 win vs loss:        ` +
    SIMS.map(s => `${s} ${dE(p.win.main, p.loss.main, s).toFixed(1)}`).join('  '));
  out.push(`${mode.padEnd(5)} delta E76 primary vs upNext:  ` +
    SIMS.map(s => `${s} ${dE(p.primary.main, p.upNext.main, s).toFixed(1)}`).join('  '));
}
out.push(`\n${fails} failing rows`);
console.log(out.join('\n'));
if (fails > 0) process.exit(1);
