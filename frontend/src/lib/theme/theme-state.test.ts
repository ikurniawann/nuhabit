// src/lib/theme/theme-state.test.ts
import { describe, expect, it } from "vitest";
import {
  applyThemeState,
  DEFAULT_THEME_STATE,
  parseThemeState,
  resolveBrand,
  serializeThemeState,
} from "./theme-state";

describe("resolveBrand", () => {
  it("uses preset colors by default", () => {
    expect(resolveBrand(DEFAULT_THEME_STATE)).toEqual({
      primary: "#daff59",
      secondary: "#00281a",
    });
  });
  it("keeps the guideline colors when an old custom theme is stored", () => {
    const brand = resolveBrand({
      ...DEFAULT_THEME_STATE,
      customPrimary: "#0ea5e9",
      customSecondary: "#6366f1",
    });
    expect(brand).toEqual({ primary: "#daff59", secondary: "#00281a" });
  });
});

describe("parseThemeState", () => {
  it("returns defaults for null / garbage", () => {
    expect(parseThemeState(null)).toEqual(DEFAULT_THEME_STATE);
    expect(parseThemeState("{not json")).toEqual(DEFAULT_THEME_STATE);
  });
  it("round-trips through serialize", () => {
    const state = { ...DEFAULT_THEME_STATE, mode: "dark" as const };
    expect(parseThemeState(serializeThemeState(state))).toEqual(state);
  });
  it("clamps unknown mode to light", () => {
    const parsed = parseThemeState(JSON.stringify({ mode: "weird" }));
    expect(parsed.mode).toBe("light");
  });
  it("returns defaults when stored value parses to null", () => {
    expect(parseThemeState("null")).toEqual(DEFAULT_THEME_STATE);
  });
  it("falls back to default preset for unknown presetId", () => {
    const parsed = parseThemeState(JSON.stringify({ presetId: "does-not-exist" }));
    expect(parsed.presetId).toBe(DEFAULT_THEME_STATE.presetId);
  });
  it("drops old custom colors while preserving the display mode", () => {
    expect(parseThemeState(JSON.stringify({ mode: "dark", customPrimary: "#0ea5e9" }))).toEqual({
      ...DEFAULT_THEME_STATE,
      mode: "dark",
    });
  });
});

describe("applyThemeState", () => {
  it("sets data-theme on the element", () => {
    const el = document.createElement("div");
    applyThemeState(el, { ...DEFAULT_THEME_STATE, mode: "dark" });
    expect(el.getAttribute("data-theme")).toBe("dark");
  });
});
