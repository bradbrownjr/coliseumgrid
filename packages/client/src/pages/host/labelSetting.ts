// The label size the host prints on. It follows the printer on this laptop, not the event, so it
// is kept in this browser (docs/PLAN.md, "Label sizes").

import { LABEL_CUSTOM_ID, LABEL_PRESETS, LABEL_PRESET_DEFAULT, isCustomLabelSize, type LabelPresetId } from '@coliseumgrid/core';
import type { PageMm } from './printLayout.ts';

export interface LabelSetting {
  preset: LabelPresetId | typeof LABEL_CUSTOM_ID;
  /** The typed size. Kept even while a preset is picked, so switching back to Custom finds it. */
  widthMm: number;
  heightMm: number;
}

export const LABEL_STORAGE_KEY = 'coliseumgrid.labelSize';

const defaultPreset = LABEL_PRESETS.find((preset) => preset.id === LABEL_PRESET_DEFAULT) ?? LABEL_PRESETS[0];

export const LABEL_DEFAULT: LabelSetting = {
  preset: LABEL_PRESET_DEFAULT,
  widthMm: defaultPreset?.widthMm ?? 62,
  heightMm: defaultPreset?.heightMm ?? 100,
};

/** The saved setting, or the default for anything missing, damaged, or outside the limits. */
export function parseLabelSetting(raw: string | null): LabelSetting {
  if (raw === null) return LABEL_DEFAULT;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return LABEL_DEFAULT;
  }
  if (typeof json !== 'object' || json === null) return LABEL_DEFAULT;
  const { preset, widthMm, heightMm } = json as { preset?: unknown; widthMm?: unknown; heightMm?: unknown };
  const known = preset === LABEL_CUSTOM_ID || LABEL_PRESETS.some((item) => item.id === preset);
  if (!known || typeof widthMm !== 'number' || typeof heightMm !== 'number' || !isCustomLabelSize(widthMm, heightMm)) return LABEL_DEFAULT;
  return { preset: preset as LabelSetting['preset'], widthMm, heightMm };
}

/** The page the setting prints on: a preset's own size, or the typed one. */
export function pageOf(setting: LabelSetting): PageMm {
  const preset = LABEL_PRESETS.find((item) => item.id === setting.preset);
  return preset ? { widthMm: preset.widthMm, heightMm: preset.heightMm } : { widthMm: setting.widthMm, heightMm: setting.heightMm };
}

// Browser storage can be missing or throw (a private window, blocked site data), so every use is
// wrapped, and the page works without it.
export function loadLabelSetting(): LabelSetting {
  try {
    return parseLabelSetting(window.localStorage.getItem(LABEL_STORAGE_KEY));
  } catch {
    return LABEL_DEFAULT;
  }
}

export function saveLabelSetting(setting: LabelSetting): void {
  try {
    window.localStorage.setItem(LABEL_STORAGE_KEY, JSON.stringify(setting));
  } catch {
    // Nowhere to keep it: the choice lasts until the page closes.
  }
}
