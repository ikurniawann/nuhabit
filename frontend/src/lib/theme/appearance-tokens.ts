import { buildBrandVars, normalizeHex, pickForeground } from "./palette";
import { DEFAULT_PRESET_ID, getPreset, THEME_PRESETS } from "./presets";

export const APPEARANCE_STORAGE_KEY = "arkiv-appearance";

export const FONT_STACKS = {
  roundo: '"Roundo", Inter, system-ui, sans-serif',
  inter: "Inter, system-ui, sans-serif",
  jakarta: '"Plus Jakarta Sans", Inter, system-ui, sans-serif',
  poppins: "Poppins, Inter, system-ui, sans-serif",
  "dm-sans": '"DM Sans", Inter, system-ui, sans-serif',
  nunito: "Nunito, Inter, system-ui, sans-serif",
  outfit: "Outfit, Inter, system-ui, sans-serif",
  manrope: "Manrope, Inter, system-ui, sans-serif",
  figtree: "Figtree, Inter, system-ui, sans-serif",
  roboto: "Roboto, Inter, system-ui, sans-serif",
  "open-sans": '"Open Sans", Inter, system-ui, sans-serif',
  lato: "Lato, Inter, system-ui, sans-serif",
  "source-sans": '"Source Sans 3", Inter, system-ui, sans-serif',
  "work-sans": '"Work Sans", Inter, system-ui, sans-serif',
  "ibm-plex-sans": '"IBM Plex Sans", Inter, system-ui, sans-serif',
  rubik: "Rubik, Inter, system-ui, sans-serif",
  mulish: "Mulish, Inter, system-ui, sans-serif",
  urbanist: "Urbanist, Inter, system-ui, sans-serif",
  sora: "Sora, Inter, system-ui, sans-serif",
  "space-grotesk": '"Space Grotesk", Inter, system-ui, sans-serif',
  "public-sans": '"Public Sans", Inter, system-ui, sans-serif',
  "noto-sans": '"Noto Sans", Inter, system-ui, sans-serif',
  karla: "Karla, Inter, system-ui, sans-serif",
  lora: 'Lora, Georgia, "Times New Roman", serif',
  merriweather: 'Merriweather, Georgia, "Times New Roman", serif',
  "source-serif": '"Source Serif 4", Georgia, "Times New Roman", serif',
  "jetbrains-mono": '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
  "ibm-plex-mono": '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace',
  system: "system-ui, -apple-system, Segoe UI, sans-serif",
} as const;

export type AppearanceFontFamily = keyof typeof FONT_STACKS;
export type AppearanceFontGroup = "sans" | "serif" | "mono" | "system";
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

export const FONT_OPTIONS: {
  value: AppearanceFontFamily;
  label: string;
  group: AppearanceFontGroup;
}[] = [
  { value: "roundo", label: "Roundo", group: "sans" },
  { value: "inter", label: "Inter", group: "sans" },
  { value: "jakarta", label: "Plus Jakarta Sans", group: "sans" },
  { value: "poppins", label: "Poppins", group: "sans" },
  { value: "dm-sans", label: "DM Sans", group: "sans" },
  { value: "nunito", label: "Nunito", group: "sans" },
  { value: "outfit", label: "Outfit", group: "sans" },
  { value: "manrope", label: "Manrope", group: "sans" },
  { value: "figtree", label: "Figtree", group: "sans" },
  { value: "roboto", label: "Roboto", group: "sans" },
  { value: "open-sans", label: "Open Sans", group: "sans" },
  { value: "lato", label: "Lato", group: "sans" },
  { value: "source-sans", label: "Source Sans 3", group: "sans" },
  { value: "work-sans", label: "Work Sans", group: "sans" },
  { value: "ibm-plex-sans", label: "IBM Plex Sans", group: "sans" },
  { value: "rubik", label: "Rubik", group: "sans" },
  { value: "mulish", label: "Mulish", group: "sans" },
  { value: "urbanist", label: "Urbanist", group: "sans" },
  { value: "sora", label: "Sora", group: "sans" },
  { value: "space-grotesk", label: "Space Grotesk", group: "sans" },
  { value: "public-sans", label: "Public Sans", group: "sans" },
  { value: "noto-sans", label: "Noto Sans", group: "sans" },
  { value: "karla", label: "Karla", group: "sans" },
  { value: "lora", label: "Lora", group: "serif" },
  { value: "merriweather", label: "Merriweather", group: "serif" },
  { value: "source-serif", label: "Source Serif 4", group: "serif" },
  { value: "jetbrains-mono", label: "JetBrains Mono", group: "mono" },
  { value: "ibm-plex-mono", label: "IBM Plex Mono", group: "mono" },
  { value: "system", label: "System UI", group: "system" },
];

export const FONT_GROUPS: { id: AppearanceFontGroup; label: string }[] = [
  { id: "sans", label: "Sans" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Mono" },
  { id: "system", label: "System" },
];

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

function safeHex(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  try {
    return normalizeHex(value);
  } catch {
    return fallback;
  }
}

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
  const base = (obj.base && typeof obj.base === "object" ? obj.base : {}) as Record<string, unknown>;
  const sidebar = (obj.sidebar && typeof obj.sidebar === "object" ? obj.sidebar : {}) as Record<
    string,
    unknown
  >;
  const navbar = (obj.navbar && typeof obj.navbar === "object" ? obj.navbar : {}) as Record<
    string,
    unknown
  >;
  const font = (obj.font && typeof obj.font === "object" ? obj.font : {}) as Record<string, unknown>;
  const presetId =
    typeof obj.presetId === "string" && getPreset(obj.presetId)
      ? obj.presetId
      : DEFAULT_APPEARANCE.presetId;

  return {
    presetId,
    base: {
      background: safeHex(base.background, DEFAULT_APPEARANCE.base.background),
      foreground: safeHex(base.foreground, DEFAULT_APPEARANCE.base.foreground),
      card: safeHex(base.card, DEFAULT_APPEARANCE.base.card),
      primary: safeHex(base.primary, DEFAULT_APPEARANCE.base.primary),
      secondary: safeHex(base.secondary, DEFAULT_APPEARANCE.base.secondary),
      destructive: safeHex(base.destructive, DEFAULT_APPEARANCE.base.destructive),
      border: safeHex(base.border, DEFAULT_APPEARANCE.base.border),
      input: safeHex(base.input, DEFAULT_APPEARANCE.base.input),
      ring: safeHex(base.ring, DEFAULT_APPEARANCE.base.ring),
    },
    sidebar: {
      background: safeHex(sidebar.background, DEFAULT_APPEARANCE.sidebar.background),
      foreground: safeHex(sidebar.foreground, DEFAULT_APPEARANCE.sidebar.foreground),
      activeBackground: safeHex(
        sidebar.activeBackground,
        DEFAULT_APPEARANCE.sidebar.activeBackground
      ),
      activeForeground: safeHex(
        sidebar.activeForeground,
        DEFAULT_APPEARANCE.sidebar.activeForeground
      ),
      border: safeHex(sidebar.border, DEFAULT_APPEARANCE.sidebar.border),
    },
    navbar: {
      background: safeHex(navbar.background, DEFAULT_APPEARANCE.navbar.background),
      foreground: safeHex(navbar.foreground, DEFAULT_APPEARANCE.navbar.foreground),
      border: safeHex(navbar.border, DEFAULT_APPEARANCE.navbar.border),
    },
    font: {
      family: isFontFamily(font.family) ? font.family : DEFAULT_APPEARANCE.font.family,
      size: isFontSize(font.size) ? font.size : DEFAULT_APPEARANCE.font.size,
    },
  };
}

export function appearanceFromPreset(presetId: string, current: AppearanceTokens): AppearanceTokens {
  const preset = getPreset(presetId) ?? getPreset(DEFAULT_PRESET_ID)!;
  const next = cloneAppearance(current);
  next.presetId = preset.id;
  next.base.primary = preset.primary;
  next.base.secondary = preset.secondary;
  next.base.ring = preset.primary;
  next.sidebar.activeBackground = preset.primary;
  next.sidebar.activeForeground = pickForeground(preset.primary);
  return next;
}

export function appearanceCssVars(tokens: AppearanceTokens): Record<string, string> {
  const brand = buildBrandVars(tokens.base.primary, tokens.base.secondary);
  return {
    ...brand,
    "--background": tokens.base.background,
    "--foreground": tokens.base.foreground,
    "--card": tokens.base.card,
    "--card-foreground": tokens.base.foreground,
    "--destructive": tokens.base.destructive,
    "--border": tokens.base.border,
    "--input": tokens.base.input,
    "--ring": tokens.base.ring,
    "--sidebar-background": tokens.sidebar.background,
    "--sidebar-foreground": tokens.sidebar.foreground,
    "--sidebar-active-background": tokens.sidebar.activeBackground,
    "--sidebar-active-foreground": tokens.sidebar.activeForeground,
    "--sidebar-border": tokens.sidebar.border,
    "--navbar-background": tokens.navbar.background,
    "--navbar-foreground": tokens.navbar.foreground,
    "--navbar-border": tokens.navbar.border,
    "--font-sans-stack": FONT_STACKS[tokens.font.family],
    "--font-size-base": `${tokens.font.size}px`,
    "--page-mesh": `linear-gradient(135deg, color-mix(in oklch, ${tokens.base.primary} 8%, ${tokens.base.background}) 0%, ${tokens.base.background} 100%)`,
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
