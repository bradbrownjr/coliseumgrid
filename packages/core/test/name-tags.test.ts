// Label presets and graphic limits (src/name-tags.ts), against docs/PLAN.md, "Label sizes" and
// "The event graphic".

import { describe, expect, it } from 'vitest';
import {
  GRAPHIC_BYTES_MAX,
  GRAPHIC_SIZE_MAX,
  GRAPHIC_SIZE_MIN,
  LABEL_CUSTOM_ID,
  LABEL_PRESETS,
  LABEL_PRESET_DEFAULT,
  LABEL_SAFE_EDGE_MM,
  isCustomLabelSize,
} from '../src/index.ts';

const POINT_MM = 25.4 / 72;

describe('LABEL_PRESETS', () => {
  it('has the two printer labels, the Brother size first and the default', () => {
    expect(LABEL_PRESETS.map((p) => [p.id, p.widthMm, p.heightMm])).toEqual([
      ['62x100mm', 62, 100],
      ['2.25x4in', 58.76, 101.6],
    ]);
    expect(LABEL_PRESET_DEFAULT).toBe(LABEL_PRESETS[0]?.id);
    expect(new Set(LABEL_PRESETS.map((p) => p.id)).size).toBe(LABEL_PRESETS.length);
    expect(LABEL_PRESETS.map((p) => p.id)).not.toContain(LABEL_CUSTOM_ID);
  });

  it('matches the DYMO driver size, 166.56 by 288 points, within 0.01 mm', () => {
    const dymo = LABEL_PRESETS.find((p) => p.id === '2.25x4in');
    expect(Math.abs((dymo?.widthMm ?? 0) - 166.56 * POINT_MM)).toBeLessThan(0.01);
    expect(Math.abs((dymo?.heightMm ?? 0) - 288 * POINT_MM)).toBeLessThan(0.01);
  });

  it('every page is taller than it is wide, and the safe edge is 3 mm', () => {
    for (const preset of LABEL_PRESETS) expect(preset.heightMm, preset.id).toBeGreaterThan(preset.widthMm);
    expect(LABEL_SAFE_EDGE_MM).toBe(3);
  });
});

describe('isCustomLabelSize', () => {
  it('takes 25 to 150 mm on each side, ends included', () => {
    expect(isCustomLabelSize(25, 150)).toBe(true);
    expect(isCustomLabelSize(62.5, 100)).toBe(true);
    expect(isCustomLabelSize(24.9, 100)).toBe(false);
    expect(isCustomLabelSize(62, 150.1)).toBe(false);
    expect(isCustomLabelSize(Number.NaN, 100)).toBe(false);
    expect(isCustomLabelSize(62, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('graphic limits', () => {
  it('are 2 MB and 16 to 4000 pixels', () => {
    expect(GRAPHIC_BYTES_MAX).toBe(2 * 1024 * 1024);
    expect([GRAPHIC_SIZE_MIN, GRAPHIC_SIZE_MAX]).toEqual([16, 4000]);
  });
});
