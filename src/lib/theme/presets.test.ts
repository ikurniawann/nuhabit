// src/lib/theme/presets.test.ts
import { describe, expect, it } from "vitest";
import { normalizeHex } from "./palette";
import { DEFAULT_PRESET_ID, getPreset, THEME_PRESETS } from "./presets";

describe("THEME_PRESETS", () => {
  it("includes wonderland as the default with the current brand blue", () => {
    const wonderland = getPreset(DEFAULT_PRESET_ID);
    expect(wonderland).toBeDefined();
    expect(wonderland!.primary).toBe("#1d1dcc");
    expect(wonderland!.secondary).toBe("#2941d3");
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
