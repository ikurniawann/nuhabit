// src/lib/theme/presets.test.ts
import { describe, expect, it } from "vitest";
import { normalizeHex } from "./palette";
import { DEFAULT_PRESET_ID, getPreset, THEME_PRESETS } from "./presets";

describe("THEME_PRESETS", () => {
  it("defaults to the NüHabit preset (Pale Lime + Deep Forest Green)", () => {
    const nuhabit = getPreset(DEFAULT_PRESET_ID);
    expect(nuhabit).toBeDefined();
    expect(nuhabit!.primary).toBe("#daff59");
    expect(nuhabit!.secondary).toBe("#00281a");
  });
  it("has unique ids and valid hex values", () => {
    const ids = new Set<string>();
    for (const p of THEME_PRESETS) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(normalizeHex(p.primary)).toBe(p.primary);
      expect(normalizeHex(p.secondary)).toBe(p.secondary);
    }
  });
  it("returns undefined for unknown id", () => {
    expect(getPreset("nope")).toBeUndefined();
  });
});
