import { afterEach, describe, expect, it, vi } from 'vitest';
import { LABEL_DEFAULT, LABEL_STORAGE_KEY, loadLabelSetting, pageOf, parseLabelSetting, saveLabelSetting } from '../src/pages/host/labelSetting.ts';

afterEach(() => vi.unstubAllGlobals());

describe('the saved label size', () => {
  it('defaults to 62 x 100 mm', () => {
    expect(LABEL_DEFAULT).toEqual({ preset: '62x100mm', widthMm: 62, heightMm: 100 });
    expect(parseLabelSetting(null)).toEqual(LABEL_DEFAULT);
  });

  it('reads a preset and a custom size', () => {
    expect(parseLabelSetting('{"preset":"2.25x4in","widthMm":62,"heightMm":100}').preset).toBe('2.25x4in');
    expect(parseLabelSetting('{"preset":"custom","widthMm":50,"heightMm":90}')).toEqual({ preset: 'custom', widthMm: 50, heightMm: 90 });
  });

  it('falls back to the default for damage and for sizes outside the limits', () => {
    for (const raw of ['', 'nope', 'null', '7', '[]', '{}', '{"preset":"huge","widthMm":62,"heightMm":100}', '{"preset":"custom","widthMm":24,"heightMm":90}', '{"preset":"custom","widthMm":50,"heightMm":151}', '{"preset":"custom","widthMm":"50","heightMm":90}']) {
      expect(parseLabelSetting(raw)).toEqual(LABEL_DEFAULT);
    }
  });

  it('prints on the preset page or the typed one', () => {
    expect(pageOf(LABEL_DEFAULT)).toEqual({ widthMm: 62, heightMm: 100 });
    expect(pageOf({ preset: '2.25x4in', widthMm: 62, heightMm: 100 })).toEqual({ widthMm: 58.76, heightMm: 101.6 });
    expect(pageOf({ preset: 'custom', widthMm: 50, heightMm: 90 })).toEqual({ widthMm: 50, heightMm: 90 });
  });
});

describe('browser storage', () => {
  it('saves and loads through localStorage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } });
    saveLabelSetting({ preset: 'custom', widthMm: 50, heightMm: 90 });
    expect(store.get(LABEL_STORAGE_KEY)).toBe('{"preset":"custom","widthMm":50,"heightMm":90}');
    expect(loadLabelSetting()).toEqual({ preset: 'custom', widthMm: 50, heightMm: 90 });
  });

  it('works when storage throws or is missing', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('window', { localStorage: { getItem: blocked, setItem: blocked } });
    expect(loadLabelSetting()).toEqual(LABEL_DEFAULT);
    expect(() => saveLabelSetting(LABEL_DEFAULT)).not.toThrow();
    vi.stubGlobal('window', undefined);
    expect(loadLabelSetting()).toEqual(LABEL_DEFAULT);
    expect(() => saveLabelSetting(LABEL_DEFAULT)).not.toThrow();
  });
});
