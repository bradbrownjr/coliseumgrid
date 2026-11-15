import { LABEL_SAFE_EDGE_MM } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import {
  BAND_SHARE,
  FIT_SLACK,
  HANDLE_PT_FLOOR,
  HANDLE_PT_MAX,
  SMALL_PT_MAX,
  SMALL_PT_MIN,
  fitPoints,
  graphicBoxMm,
  handleMaxPt,
  mmToPt,
  printCss,
  smallTextPt,
  tagGeometry,
} from '../src/pages/host/printLayout.ts';

const brother = { widthMm: 62, heightMm: 100 };

describe('the tag geometry', () => {
  it('draws a tall page wide and turns it a quarter turn', () => {
    const g = tagGeometry(brother);
    expect(g.turn).toBe(true);
    expect([g.wideMm, g.tallMm]).toEqual([100, 62]);
    // 3 mm in from every edge.
    expect([g.innerWideMm, g.innerTallMm]).toEqual([100 - 2 * LABEL_SAFE_EDGE_MM, 62 - 2 * LABEL_SAFE_EDGE_MM]);
    expect(g.bandMm + g.handleMm).toBeCloseTo(g.innerTallMm);
    expect(g.bandMm).toBeCloseTo(g.innerTallMm * BAND_SHARE);
  });

  it('leaves a wide page as it is', () => {
    const g = tagGeometry({ widthMm: 90, heightMm: 50 });
    expect(g.turn).toBe(false);
    expect([g.wideMm, g.tallMm]).toEqual([90, 50]);
  });

  it('never goes negative on the smallest label', () => {
    const g = tagGeometry({ widthMm: 25, heightMm: 25 });
    expect(g.innerWideMm).toBe(19);
    expect(g.handleMm).toBeGreaterThan(0);
  });
});

describe('the graphic box', () => {
  const g = tagGeometry(brother);

  it('keeps the picture in its own proportions', () => {
    for (const [width, height] of [[400, 400], [900, 300], [300, 900], [4000, 16]] as const) {
      const box = graphicBoxMm({ width, height }, g);
      expect(box.widthMm / box.heightMm).toBeCloseTo(width / height);
    }
  });

  it('takes at most a third of the width and the height of the band', () => {
    for (const [width, height] of [[400, 400], [900, 300], [300, 900], [4000, 16], [16, 4000]] as const) {
      const box = graphicBoxMm({ width, height }, g);
      expect(box.widthMm).toBeLessThanOrEqual(g.innerWideMm / 3 + 1e-9);
      expect(box.heightMm).toBeLessThanOrEqual(g.bandMm + 1e-9);
    }
  });

  it('fills the band with a square picture', () => {
    expect(graphicBoxMm({ width: 400, height: 400 }, g).heightMm).toBeCloseTo(g.bandMm);
  });
});

describe('type sizes', () => {
  it('gives the small text 12 points on a 62 mm label and never under 7', () => {
    expect(smallTextPt(tagGeometry(brother))).toBe(SMALL_PT_MAX);
    expect(smallTextPt(tagGeometry({ widthMm: 25, heightMm: 40 }))).toBe(SMALL_PT_MIN);
  });

  it('lets the handle reach 72 points on the presets, and less on a short label', () => {
    expect(handleMaxPt(tagGeometry(brother))).toBe(HANDLE_PT_MAX);
    expect(handleMaxPt(tagGeometry({ widthMm: 58.76, heightMm: 101.6 }))).toBe(HANDLE_PT_MAX);
    expect(handleMaxPt(tagGeometry({ widthMm: 25, heightMm: 60 }))).toBeLessThan(HANDLE_PT_MAX);
    expect(mmToPt(25.4)).toBe(72);
  });
});

describe('fitting the handle', () => {
  // Text width grows with the size; 5 points of width for each point of type is a stand-in for a font.
  const linear = (perPt: number) => (pt: number) => pt * perPt;

  it('keeps the largest size when it fits', () => {
    expect(fitPoints(linear(5), 400)).toBe(HANDLE_PT_MAX);
  });

  it('shrinks until the text fits, with a little room to spare', () => {
    const pt = fitPoints(linear(8), 300);
    expect(pt).toBeLessThan(HANDLE_PT_MAX);
    expect(linear(8)(pt)).toBeLessThanOrEqual(300 * FIT_SLACK);
    // The next half point up would not fit, so this is the largest.
    expect(linear(8)(pt + 0.5)).toBeGreaterThan(300 * FIT_SLACK);
  });

  it('finds the size when the text is not exactly linear', () => {
    // A measure that rounds up to whole pixels, as offsetWidth does.
    const rounded = (pt: number) => Math.ceil(pt * 6.3);
    const pt = fitPoints(rounded, 250);
    expect(rounded(pt)).toBeLessThanOrEqual(250 * FIT_SLACK);
    expect(rounded(pt + 0.5)).toBeGreaterThan(250 * FIT_SLACK);
  });

  it('never goes under the floor, so a handle of the widest letters stays inside the edge as far as it can', () => {
    expect(fitPoints(linear(100), 300)).toBe(HANDLE_PT_FLOOR);
  });

  it('respects a lower maximum', () => {
    expect(fitPoints(linear(1), 400, 30)).toBe(30);
  });
});

describe('the print page rules', () => {
  it('sets the page size and no margin from the label', () => {
    expect(printCss({ widthMm: 58.76, heightMm: 101.6 })).toContain('@page { size: 58.76mm 101.6mm; margin: 0; }');
  });

  it('hides everything but the sheet when printing, and prints black on white', () => {
    const css = printCss(brother);
    expect(css).toContain('@media print');
    expect(css).toContain('body > *:not(#print-sheet) { display: none !important; }');
    expect(css).toContain('background: white !important');
    // No hex colors: the tag is black and white by name (CLAUDE.md, rule 10).
    expect(css).not.toMatch(/#(?!print-sheet)[0-9a-f]{3,8}\b/i);
  });
});
