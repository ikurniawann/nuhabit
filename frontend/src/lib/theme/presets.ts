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
  { id: "wonderland", label: "Biru", primary: "#1d1dcc", secondary: "#2941d3" },
  { id: "ocean", label: "Ocean", primary: "#0ea5e9", secondary: "#6366f1" },
  { id: "emerald", label: "Emerald", primary: "#10b981", secondary: "#14b8a6" },
  { id: "graphite", label: "Graphite", primary: "#334155", secondary: "#64748b" },
  { id: "sunset", label: "Sunset", primary: "#f97316", secondary: "#ef4444" },
] as const;

export function getPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}
