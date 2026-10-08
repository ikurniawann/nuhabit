import { buildBrandVars } from "./palette";
import { DEFAULT_PRESET_ID, THEME_PRESETS } from "./presets";

export const APPEARANCE_STORAGE_KEY = "arkiv-appearance";

export const FONT_STACKS = {
  manrope: '"Manrope", ui-sans-serif, system-ui, sans-serif',
} as const;

export type AppearanceFontFamily = keyof typeof FONT_STACKS;
export type AppearanceFontSize = 14 | 15 | 16;

export type AppearanceTokens = {
  presetId: string;
  base: {
    background: string;
    foreground: string;
    card: string;
    primary: string;
    secondary: string;
    destructive: string;
    border: string;
    input: string;
    ring: string;
  };
  sidebar: {
    background: string;
    foreground: string;
    activeBackground: string;
    activeForeground: string;
    border: string;
  };
  navbar: {
    background: string;
    foreground: string;
    border: string;
  };
  font: {
    family: AppearanceFontFamily;
    size: AppearanceFontSize;
  };
};

export const FONT_SIZE_OPTIONS: { value: AppearanceFontSize; label: string }[] = [
  { value: 14, label: "14px" },
  { value: 15, label: "15px" },
  { value: 16, label: "16px" },
];

export const DEFAULT_APPEARANCE: AppearanceTokens = {
  presetId: DEFAULT_PRESET_ID,
  base: {
    background: "#fdfff2",
    foreground: "#131a1c",
    card: "#fdfff2",
    primary: "#daff59",
    secondary: "#00281a",
    destructive: "#b3262c",
    border: "#e3dbcc",
    input: "#e3dbcc",
    ring: "#203b32",
  },
  sidebar: {
    background: "#131a1c",
    foreground: "#fdfff2",
    activeBackground: "#daff59",
    activeForeground: "#00281a",
    border: "#131a1c",
  },
  navbar: {
    background: "#f3ece2",
    foreground: "#131a1c",
    border: "#e3dbcc",
  },
  font: {
    family: "manrope",
    size: 16,
  },
};

function isFontFamily(value: unknown): value is AppearanceFontFamily {
  return typeof value === "string" && value in FONT_STACKS;
}

function isFontSize(value: unknown): value is AppearanceFontSize {
  return value === 14 || value === 15 || value === 16;
}

export function cloneAppearance(tokens: AppearanceTokens = DEFAULT_APPEARANCE): AppearanceTokens {
  return JSON.parse(JSON.stringify(tokens)) as AppearanceTokens;
}

export function parseAppearanceTokens(raw: unknown): AppearanceTokens {
  if (!raw || typeof raw !== "object") return cloneAppearance();
  const obj = raw as Record<string, unknown>;
  const font = (obj.font && typeof obj.font === "object" ? obj.font : {}) as Record<string, unknown>;
  return {
    ...cloneAppearance(),
    font: {
      family: isFontFamily(font.family) ? font.family : DEFAULT_APPEARANCE.font.family,
      size: isFontSize(font.size) ? font.size : DEFAULT_APPEARANCE.font.size,
    },
  };
}

export function appearanceFromPreset(_presetId: string, current: AppearanceTokens): AppearanceTokens {
  return parseAppearanceTokens(current);
}

export function appearanceCssVars(tokens: AppearanceTokens): Record<string, string> {
  const fixed = DEFAULT_APPEARANCE;
  const brand = buildBrandVars(fixed.base.primary, fixed.base.secondary);
  return {
    ...brand,
    "--background": fixed.base.background,
    "--foreground": fixed.base.foreground,
    "--card": fixed.base.card,
    "--card-foreground": fixed.base.foreground,
    "--destructive": fixed.base.destructive,
    "--border": fixed.base.border,
    "--input": fixed.base.input,
    "--ring": fixed.base.ring,
    "--sidebar-background": fixed.sidebar.background,
    "--sidebar-foreground": fixed.sidebar.foreground,
    "--sidebar-active-background": fixed.sidebar.activeBackground,
    "--sidebar-active-foreground": fixed.sidebar.activeForeground,
    "--sidebar-border": fixed.sidebar.border,
    "--navbar-background": fixed.navbar.background,
    "--navbar-foreground": fixed.navbar.foreground,
    "--navbar-border": fixed.navbar.border,
    "--font-sans-stack": FONT_STACKS.manrope,
    "--font-size-base": `${isFontSize(tokens.font.size) ? tokens.font.size : fixed.font.size}px`,
    "--page-mesh": `linear-gradient(135deg, color-mix(in oklch, ${fixed.base.primary} 8%, ${fixed.base.background}) 0%, ${fixed.base.background} 100%)`,
  };
}

export function applyAppearanceTokens(root: HTMLElement, tokens: AppearanceTokens): void {
  const vars = appearanceCssVars(tokens);
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

export function readCachedAppearance(): AppearanceTokens {
  if (typeof window === "undefined") return cloneAppearance();
  try {
    return parseAppearanceTokens(JSON.parse(window.localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "null"));
  } catch {
    return cloneAppearance();
  }
}

export function writeCachedAppearance(tokens: AppearanceTokens): void {
  window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(tokens));
}

export function appearanceEquals(a: AppearanceTokens, b: AppearanceTokens): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export { THEME_PRESETS };
