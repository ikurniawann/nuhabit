// src/lib/theme/theme-state.ts
import { DEFAULT_PRESET_ID, getPreset } from "./presets";

export type ThemeMode = "light" | "dark" | "auto";

export type ThemeState = {
  presetId: string;
  customPrimary: string | null;
  customSecondary: string | null;
  mode: ThemeMode;
};

export const THEME_STORAGE_KEY = "arkiv-theme";

export const DEFAULT_THEME_STATE: ThemeState = {
  presetId: DEFAULT_PRESET_ID,
  customPrimary: null,
  customSecondary: null,
  mode: "light",
};

const MODES: ThemeMode[] = ["light", "dark", "auto"];

export function resolveBrand(_state: ThemeState): { primary: string; secondary: string } {
  const preset = getPreset(DEFAULT_PRESET_ID)!;
  return {
    primary: preset.primary,
    secondary: preset.secondary,
  };
}

export function parseThemeState(raw: string | null): ThemeState {
  if (!raw) return DEFAULT_THEME_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_THEME_STATE;
  }
  if (!parsed || typeof parsed !== "object") return DEFAULT_THEME_STATE;
  const obj = parsed as Record<string, unknown>;
  const mode = MODES.includes(obj.mode as ThemeMode)
    ? (obj.mode as ThemeMode)
    : "light";
  return {
    presetId: DEFAULT_PRESET_ID,
    customPrimary: null,
    customSecondary: null,
    mode,
  };
}

export function serializeThemeState(state: ThemeState): string {
  return JSON.stringify(state);
}

export function applyThemeState(root: HTMLElement, state: ThemeState): void {
  root.setAttribute("data-theme", state.mode);
}
