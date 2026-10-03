import { describe, expect, it } from "vitest";
import {
  appearanceFromPreset,
  appearanceCssVars,
  applyAppearanceTokens,
  DEFAULT_APPEARANCE,
  FONT_OPTIONS,
  FONT_STACKS,
  parseAppearanceTokens,
} from "./appearance-tokens";

describe("parseAppearanceTokens", () => {
  it("returns defaults for null / garbage", () => {
    expect(parseAppearanceTokens(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearanceTokens("nope")).toEqual(DEFAULT_APPEARANCE);
  });

  it("fills missing keys and normalizes hex", () => {
    const parsed = parseAppearanceTokens({
      base: { primary: "0EA5E9" },
      font: { family: "inter", size: 14 },
    });
    expect(parsed.base.primary).toBe("#0ea5e9");
    expect(parsed.base.background).toBe(DEFAULT_APPEARANCE.base.background);
    expect(parsed.font).toEqual({ family: "inter", size: 14 });
  });

  it("rejects invalid font / size", () => {
    const parsed = parseAppearanceTokens({
      font: { family: "comic", size: 99 },
    });
    expect(parsed.font).toEqual(DEFAULT_APPEARANCE.font);
  });

  it("accepts expanded font families", () => {
    const parsed = parseAppearanceTokens({
      font: { family: "poppins", size: 15 },
    });
    expect(parsed.font).toEqual({ family: "poppins", size: 15 });
  });
});

describe("FONT_OPTIONS", () => {
  it("covers every stack key exactly once", () => {
    const values = FONT_OPTIONS.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values.sort()).toEqual(Object.keys(FONT_STACKS).sort());
  });
});

describe("appearanceFromPreset", () => {
  it("updates brand + sidebar active from preset", () => {
    const next = appearanceFromPreset("ocean", DEFAULT_APPEARANCE);
    expect(next.presetId).toBe("ocean");
    expect(next.base.primary).toBe("#0ea5e9");
    expect(next.sidebar.activeBackground).toBe("#0ea5e9");
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
});
