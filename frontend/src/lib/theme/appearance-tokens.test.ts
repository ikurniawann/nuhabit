import { describe, expect, it } from "vitest";
import {
  appearanceFromPreset,
  appearanceCssVars,
  applyAppearanceTokens,
  DEFAULT_APPEARANCE,
  FONT_STACKS,
  parseAppearanceTokens,
} from "./appearance-tokens";

describe("parseAppearanceTokens", () => {
  it("returns defaults for null / garbage", () => {
    expect(parseAppearanceTokens(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearanceTokens("nope")).toEqual(DEFAULT_APPEARANCE);
  });

  it("replaces stored company colors with the NüHabit palette", () => {
    const parsed = parseAppearanceTokens({
      base: { primary: "0EA5E9" },
      font: { family: "inter", size: 14 },
    });
    expect(parsed.base.primary).toBe("#daff59");
    expect(parsed.base.background).toBe(DEFAULT_APPEARANCE.base.background);
    expect(parsed.font).toEqual({ family: "manrope", size: 14 });
  });

  it("rejects invalid font / size", () => {
    const parsed = parseAppearanceTokens({
      font: { family: "comic", size: 99 },
    });
    expect(parsed.font).toEqual(DEFAULT_APPEARANCE.font);
  });

  it("normalizes a previously selected font to Manrope", () => {
    const parsed = parseAppearanceTokens({
      font: { family: "poppins", size: 15 },
    });
    expect(parsed.font).toEqual({ family: "manrope", size: 15 });
  });
});

describe("FONT_STACKS", () => {
  it("uses Manrope for body text", () => {
    expect(Object.keys(FONT_STACKS)).toEqual(["manrope"]);
    expect(FONT_STACKS.manrope).toContain("Manrope");
  });
});

describe("appearanceFromPreset", () => {
  it("keeps the NüHabit palette for a legacy preset", () => {
    const next = appearanceFromPreset("ocean", DEFAULT_APPEARANCE);
    expect(next.presetId).toBe("nuhabit");
    expect(next.base.primary).toBe("#daff59");
    expect(next.sidebar.activeBackground).toBe("#daff59");
    expect(next.sidebar.activeForeground).toBe("#00281a");
  });
});

describe("applyAppearanceTokens", () => {
  it("sets css variables on the element", () => {
    const el = document.createElement("div");
    applyAppearanceTokens(el, DEFAULT_APPEARANCE);
    const vars = appearanceCssVars(DEFAULT_APPEARANCE);
    expect(el.style.getPropertyValue("--brand-primary")).toBe(vars["--brand-primary"]);
    expect(el.style.getPropertyValue("--sidebar-background")).toBe(
      DEFAULT_APPEARANCE.sidebar.background
    );
    expect(el.style.getPropertyValue("--font-size-base")).toBe("16px");
  });
  it("does not apply caller supplied brand colors", () => {
    const custom = {
      ...DEFAULT_APPEARANCE,
      base: { ...DEFAULT_APPEARANCE.base, primary: "#0ea5e9" },
    };
    expect(appearanceCssVars(custom)["--brand-primary"]).toBe("#daff59");
  });
});
