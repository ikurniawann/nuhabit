// src/lib/theme/presets.ts
export type ThemePreset = {
  id: string;
  label: string;
  primary: string;
  secondary: string;
};

export const DEFAULT_PRESET_ID = "nuhabit";

export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: "nuhabit", label: "NüHabit", primary: "#daff59", secondary: "#00281a" },
] as const;

export function getPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}
