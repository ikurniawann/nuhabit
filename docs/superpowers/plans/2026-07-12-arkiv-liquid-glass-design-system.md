# Arkiv OS Liquid Glass Design System + Theme Customization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-architect Arkiv OS styling onto a CSS-variable token system, add a per-user theme customization feature (presets + custom primary/secondary + light/dark/auto), refine iOS/ColorOS glassmorphism, add a centralized motion system, and add a role-aware tooltip/help layer — proven end-to-end on the POS pilot surfaces.

**Architecture:** Three-tier CSS variable tokens in `globals.css` (brand inputs → color-mix-derived scales → semantic tokens), applied at runtime by a client `ThemeProvider` (persisted to `localStorage`) with a blocking anti-flash script. shadcn "base-nova" components consume semantic tokens; hardcoded pink `!important` overrides are removed and replaced with token rules. Motion and tooltip primitives are new shared modules.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS v4 (CSS-first), `@base-ui/react`, `class-variance-authority`, `framer-motion` (installed), `tw-animate-css` (installed), `vitest` + `@testing-library/react` + `jsdom` (installed).

## Global Constraints

- No changes to business logic, data flow, API contracts, or routes. Presentational + new theme feature only.
- No breaking changes to component public APIs; `DialogPanel` structure stays stable.
- No new runtime dependencies. Use only already-installed packages.
- Theme persistence is **per-user `localStorage`** (key `arkiv-theme`); no DB/schema changes.
- Default preset **"Wonderland"** must reproduce the current pink look: primary `#db2777`, gradient partner `#ec4899`, deep `#be185d`.
- Motion must honor `prefers-reduced-motion` and animate only `transform`/`opacity` on hot paths (no per-row `backdrop-blur`).
- Contrast: text on brand fills must target ratio ≥ 4.5:1 (auto-picked foreground).
- Indonesian is the UI copy language (match existing pages).
- shadcn neutral tokens (`--secondary`, `--accent`, `--muted`) remain **neutral grays**. The customizable second brand hue is a **separate** token `--brand-secondary` (used for gradients/charts/accents), so existing `bg-secondary` usages don't turn vivid.

---

## Token naming reference (used across all tasks)

**Brand inputs (user-editable):** `--brand-primary`, `--brand-secondary`.

**Derived scales (CSS `color-mix`, defined in `globals.css`):**
`--primary-50 … --primary-950`, `--brand-secondary-50 … --brand-secondary-950`.

**Semantic (consumed by components):**
`--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`,
`--muted`, `--muted-foreground`, `--secondary`, `--secondary-foreground`, `--accent`,
`--accent-foreground`, `--border`, `--input`, `--ring`, `--primary`, `--primary-foreground`,
`--destructive`, `--success`, `--warning`.

**Glass:** `--glass-bg`, `--glass-border`, `--glass-blur`, `--glass-saturate`, `--glass-shadow`, `--glass-highlight`.

**Shape/motion:** `--radius`, `--dur-fast`, `--dur-base`, `--dur-slow`, `--ease-glass`, `--ease-out`.

**Runtime-injected by ThemeProvider (only these three, everything else derives in CSS):**
`--brand-primary`, `--brand-secondary`, `--primary-foreground`.

---

# PHASE 0 — Global Foundation

### Task 1: Theme palette utilities (pure, tested)

**Files:**
- Create: `src/lib/theme/palette.ts`
- Test: `src/lib/theme/palette.test.ts`

**Interfaces:**
- Produces:
  - `normalizeHex(input: string): string` — returns lowercased `#rrggbb`; throws `Error` on invalid.
  - `relativeLuminance(hex: string): number` — WCAG relative luminance in `[0,1]`.
  - `contrastRatio(a: string, b: string): number` — WCAG contrast ratio `[1,21]`.
  - `pickForeground(bg: string): "#ffffff" | "#0a0a0a"` — higher-contrast text color.
  - `type BrandVars = { "--brand-primary": string; "--brand-secondary": string; "--primary-foreground": string }`
  - `buildBrandVars(primary: string, secondary: string): BrandVars`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/theme/palette.test.ts
import { describe, expect, it } from "vitest";
import {
  buildBrandVars,
  contrastRatio,
  normalizeHex,
  pickForeground,
  relativeLuminance,
} from "./palette";

describe("normalizeHex", () => {
  it("expands shorthand and lowercases", () => {
    expect(normalizeHex("#FFF")).toBe("#ffffff");
    expect(normalizeHex("DB2777")).toBe("#db2777");
  });
  it("throws on invalid input", () => {
    expect(() => normalizeHex("not-a-color")).toThrow();
    expect(() => normalizeHex("#12")).toThrow();
  });
});

describe("relativeLuminance", () => {
  it("is 0 for black and ~1 for white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("contrastRatio", () => {
  it("is 21 for black vs white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });
});

describe("pickForeground", () => {
  it("uses white text on the dark default pink", () => {
    expect(pickForeground("#db2777")).toBe("#ffffff");
  });
  it("uses dark text on a light brand color", () => {
    expect(pickForeground("#fde68a")).toBe("#0a0a0a");
  });
  it("guarantees >= 4.5 contrast against the chosen brand", () => {
    for (const c of ["#db2777", "#0ea5e9", "#10b981", "#fde68a", "#111827"]) {
      const fg = pickForeground(c);
      expect(contrastRatio(fg, c)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("buildBrandVars", () => {
  it("returns the three runtime-injected variables", () => {
    const vars = buildBrandVars("db2777", "#ec4899");
    expect(vars["--brand-primary"]).toBe("#db2777");
    expect(vars["--brand-secondary"]).toBe("#ec4899");
    expect(vars["--primary-foreground"]).toBe("#ffffff");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/theme/palette.test.ts`
Expected: FAIL — cannot find module `./palette`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/theme/palette.ts
/** Pure color utilities for runtime theme generation. No dependencies. */

export function normalizeHex(input: string): string {
  let h = input.trim().toLowerCase();
  if (h.startsWith("#")) h = h.slice(1);
  if (/^[0-9a-f]{3}$/.test(h)) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-f]{6}$/.test(h)) {
    throw new Error(`Invalid hex color: ${input}`);
  }
  return `#${h}`;
}

function toChannels(hex: string): [number, number, number] {
  const h = normalizeHex(hex).slice(1);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function channelLuminance(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = toChannels(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

const LIGHT_TEXT = "#ffffff";
const DARK_TEXT = "#0a0a0a";

export function pickForeground(bg: string): typeof LIGHT_TEXT | typeof DARK_TEXT {
  return contrastRatio(LIGHT_TEXT, bg) >= contrastRatio(DARK_TEXT, bg)
    ? LIGHT_TEXT
    : DARK_TEXT;
}

export type BrandVars = {
  "--brand-primary": string;
  "--brand-secondary": string;
  "--primary-foreground": string;
};

export function buildBrandVars(primary: string, secondary: string): BrandVars {
  const p = normalizeHex(primary);
  return {
    "--brand-primary": p,
    "--brand-secondary": normalizeHex(secondary),
    "--primary-foreground": pickForeground(p),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/theme/palette.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme/palette.ts src/lib/theme/palette.test.ts
git commit -m "feat(theme): add pure color palette utilities"
```

---

### Task 2: Theme presets (typed, tested)

**Files:**
- Create: `src/lib/theme/presets.ts`
- Test: `src/lib/theme/presets.test.ts`

**Interfaces:**
- Consumes: `normalizeHex` from Task 1.
- Produces:
  - `type ThemePreset = { id: string; label: string; primary: string; secondary: string }`
  - `export const THEME_PRESETS: readonly ThemePreset[]`
  - `export const DEFAULT_PRESET_ID = "wonderland"`
  - `getPreset(id: string): ThemePreset | undefined`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/theme/presets.test.ts
import { describe, expect, it } from "vitest";
import { normalizeHex } from "./palette";
import { DEFAULT_PRESET_ID, getPreset, THEME_PRESETS } from "./presets";

describe("THEME_PRESETS", () => {
  it("includes wonderland as the default with the current pink", () => {
    const wonderland = getPreset(DEFAULT_PRESET_ID);
    expect(wonderland).toBeDefined();
    expect(wonderland!.primary).toBe("#db2777");
    expect(wonderland!.secondary).toBe("#ec4899");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/theme/presets.test.ts`
Expected: FAIL — cannot find module `./presets`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/theme/presets.ts
export type ThemePreset = {
  id: string;
  label: string;
  primary: string;
  secondary: string;
};

export const DEFAULT_PRESET_ID = "wonderland";

export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: "wonderland", label: "Wonderland", primary: "#db2777", secondary: "#ec4899" },
  { id: "ocean", label: "Ocean", primary: "#0ea5e9", secondary: "#6366f1" },
  { id: "emerald", label: "Emerald", primary: "#10b981", secondary: "#14b8a6" },
  { id: "graphite", label: "Graphite", primary: "#334155", secondary: "#64748b" },
  { id: "sunset", label: "Sunset", primary: "#f97316", secondary: "#ef4444" },
] as const;

export function getPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/theme/presets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme/presets.ts src/lib/theme/presets.test.ts
git commit -m "feat(theme): add theme presets"
```

---

### Task 3: Theme state module (pure resolve + apply, tested)

**Files:**
- Create: `src/lib/theme/theme-state.ts`
- Test: `src/lib/theme/theme-state.test.ts`

**Interfaces:**
- Consumes: `buildBrandVars`, `normalizeHex` (Task 1); `getPreset`, `DEFAULT_PRESET_ID` (Task 2).
- Produces:
  - `type ThemeMode = "light" | "dark" | "auto"`
  - `type ThemeState = { presetId: string; customPrimary: string | null; customSecondary: string | null; mode: ThemeMode }`
  - `export const DEFAULT_THEME_STATE: ThemeState`
  - `export const THEME_STORAGE_KEY = "arkiv-theme"`
  - `resolveBrand(state: ThemeState): { primary: string; secondary: string }` — custom overrides win over preset.
  - `parseThemeState(raw: string | null): ThemeState` — tolerant of malformed input, falls back to defaults.
  - `serializeThemeState(state: ThemeState): string`
  - `applyThemeState(root: HTMLElement, state: ThemeState): void` — sets `data-theme` attribute + injects the three brand CSS vars.

- [ ] **Step 1: Write the failing test**

```ts
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
      primary: "#db2777",
      secondary: "#ec4899",
    });
  });
  it("prefers custom colors when set", () => {
    const brand = resolveBrand({
      ...DEFAULT_THEME_STATE,
      customPrimary: "#0ea5e9",
      customSecondary: "#6366f1",
    });
    expect(brand).toEqual({ primary: "#0ea5e9", secondary: "#6366f1" });
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
});

describe("applyThemeState", () => {
  it("sets data-theme and brand vars on the element", () => {
    const el = document.createElement("div");
    applyThemeState(el, { ...DEFAULT_THEME_STATE, mode: "dark" });
    expect(el.getAttribute("data-theme")).toBe("dark");
    expect(el.style.getPropertyValue("--brand-primary")).toBe("#db2777");
    expect(el.style.getPropertyValue("--primary-foreground")).toBe("#ffffff");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/theme/theme-state.test.ts`
Expected: FAIL — cannot find module `./theme-state`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/theme/theme-state.ts
import { buildBrandVars, normalizeHex } from "./palette";
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

function safeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return normalizeHex(value);
  } catch {
    return null;
  }
}

export function resolveBrand(state: ThemeState): { primary: string; secondary: string } {
  const preset = getPreset(state.presetId) ?? getPreset(DEFAULT_PRESET_ID)!;
  return {
    primary: state.customPrimary ?? preset.primary,
    secondary: state.customSecondary ?? preset.secondary,
  };
}

export function parseThemeState(raw: string | null): ThemeState {
  if (!raw) return DEFAULT_THEME_STATE;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return DEFAULT_THEME_STATE;
  }
  const mode = MODES.includes(obj.mode as ThemeMode)
    ? (obj.mode as ThemeMode)
    : "light";
  const presetId =
    typeof obj.presetId === "string" && getPreset(obj.presetId)
      ? obj.presetId
      : DEFAULT_PRESET_ID;
  return {
    presetId,
    customPrimary: safeHex(obj.customPrimary),
    customSecondary: safeHex(obj.customSecondary),
    mode,
  };
}

export function serializeThemeState(state: ThemeState): string {
  return JSON.stringify(state);
}

export function applyThemeState(root: HTMLElement, state: ThemeState): void {
  root.setAttribute("data-theme", state.mode);
  const { primary, secondary } = resolveBrand(state);
  const vars = buildBrandVars(primary, secondary);
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/theme/theme-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme/theme-state.ts src/lib/theme/theme-state.test.ts
git commit -m "feat(theme): add theme state resolve/parse/apply module"
```

---

### Task 4: Token layer in globals.css + Tailwind dark variant + strangle pink

**Files:**
- Modify: `src/app/globals.css` (add token layer at top; replace `!important` pink blocks)
- Modify: `src/app/layout.tsx:3-5` (drop pink/blue css imports)
- Delete: `src/app/pink-buttons.css`, `src/app/blue-theme.css`

**Interfaces:**
- Produces: all semantic + glass + motion CSS variables (see Token naming reference) available app-wide; `dark` Tailwind variant bound to `[data-theme="dark"]` and to `[data-theme="auto"]` under `prefers-color-scheme: dark`.

- [ ] **Step 1: Add the token layer** at the very top of `src/app/globals.css`, immediately after `@import "tailwindcss";` (keep the existing Fontshare `@import` on line 1 first — CSS requires `@import` before other rules):

```css
@import "tw-animate-css";

/* Bind the `dark:` variant to our explicit theme attribute (manual + auto). */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

/* Expose CSS variables to Tailwind's utility generator. */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-md: var(--radius);
}

:root {
  /* Brand inputs — overridden at runtime by ThemeProvider. */
  --brand-primary: #db2777;
  --brand-secondary: #ec4899;
  --primary-foreground: #ffffff;

  /* Derived brand scales (perceptual mix in OKLCH). */
  --primary-50: color-mix(in oklch, var(--brand-primary) 8%, white);
  --primary-100: color-mix(in oklch, var(--brand-primary) 16%, white);
  --primary-200: color-mix(in oklch, var(--brand-primary) 30%, white);
  --primary-300: color-mix(in oklch, var(--brand-primary) 46%, white);
  --primary-400: color-mix(in oklch, var(--brand-primary) 70%, white);
  --primary-500: var(--brand-primary);
  --primary-600: color-mix(in oklch, var(--brand-primary) 88%, black);
  --primary-700: color-mix(in oklch, var(--brand-primary) 74%, black);
  --primary-800: color-mix(in oklch, var(--brand-primary) 60%, black);
  --primary-900: color-mix(in oklch, var(--brand-primary) 46%, black);
  --primary-950: color-mix(in oklch, var(--brand-primary) 34%, black);

  --brand-secondary-400: color-mix(in oklch, var(--brand-secondary) 70%, white);
  --brand-secondary-500: var(--brand-secondary);
  --brand-secondary-600: color-mix(in oklch, var(--brand-secondary) 88%, black);

  /* Semantic — light. */
  --background: #ffffff;
  --foreground: #0f172a;
  --card: rgba(255, 255, 255, 0.72);
  --card-foreground: #0f172a;
  --popover: #ffffff;
  --popover-foreground: #0f172a;
  --primary: var(--primary-500);
  --secondary: #f1f5f9;
  --secondary-foreground: #0f172a;
  --muted: #f1f5f9;
  --muted-foreground: #64748b;
  --accent: #f1f5f9;
  --accent-foreground: #0f172a;
  --destructive: #dc2626;
  --success: #16a34a;
  --warning: #d97706;
  --border: rgba(209, 213, 219, 0.5);
  --input: rgba(209, 213, 219, 0.6);
  --ring: color-mix(in oklch, var(--brand-primary) 45%, white);

  /* Glass — light. */
  --glass-bg: rgba(255, 255, 255, 0.7);
  --glass-border: rgba(209, 213, 219, 0.35);
  --glass-blur: 24px;
  --glass-saturate: 1.8;
  --glass-shadow: 0 2px 20px rgba(0, 0, 0, 0.04), 0 1px 4px rgba(0, 0, 0, 0.03);
  --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.85);

  /* Shape + motion. */
  --radius: 0.75rem;
  --dur-fast: 120ms;
  --dur-base: 220ms;
  --dur-slow: 360ms;
  --ease-glass: cubic-bezier(0.32, 0.72, 0, 1);
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);

  /* Page mesh background (brand-tinted). */
  --page-mesh: linear-gradient(
    135deg,
    color-mix(in oklch, var(--brand-primary) 6%, #eef2ff) 0%,
    #faf5ff 40%,
    #f0f9ff 75%,
    color-mix(in oklch, var(--brand-primary) 8%, #fef3ff) 100%
  );
}

[data-theme="dark"] {
  --background: #0b1220;
  --foreground: #e5e7eb;
  --card: rgba(15, 23, 42, 0.82);
  --card-foreground: #e5e7eb;
  --popover: #0f172a;
  --popover-foreground: #e5e7eb;
  --secondary: #1e293b;
  --secondary-foreground: #e5e7eb;
  --muted: #1e293b;
  --muted-foreground: #94a3b8;
  --accent: #1e293b;
  --accent-foreground: #e5e7eb;
  --border: rgba(148, 163, 184, 0.28);
  --input: rgba(148, 163, 184, 0.36);
  --ring: color-mix(in oklch, var(--brand-primary) 55%, black);

  --glass-bg: rgba(15, 23, 42, 0.72);
  --glass-border: rgba(148, 163, 184, 0.24);
  --glass-shadow: 0 2px 24px rgba(0, 0, 0, 0.35), 0 1px 4px rgba(0, 0, 0, 0.3);
  --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.08);

  --page-mesh: linear-gradient(135deg, #020617 0%, #111827 42%, #1e1b4b 74%, #3b1235 100%);
}

/* Auto mode follows the OS when nothing explicit is chosen. */
@media (prefers-color-scheme: dark) {
  [data-theme="auto"] {
    --background: #0b1220;
    --foreground: #e5e7eb;
    --card: rgba(15, 23, 42, 0.82);
    --card-foreground: #e5e7eb;
    --popover: #0f172a;
    --popover-foreground: #e5e7eb;
    --secondary: #1e293b;
    --secondary-foreground: #e5e7eb;
    --muted: #1e293b;
    --muted-foreground: #94a3b8;
    --accent: #1e293b;
    --accent-foreground: #e5e7eb;
    --border: rgba(148, 163, 184, 0.28);
    --input: rgba(148, 163, 184, 0.36);
    --glass-bg: rgba(15, 23, 42, 0.72);
    --glass-border: rgba(148, 163, 184, 0.24);
    --page-mesh: linear-gradient(135deg, #020617 0%, #111827 42%, #1e1b4b 74%, #3b1235 100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
```

- [ ] **Step 2: Replace the hardcoded glass + pink blocks.** In `src/app/globals.css`, rewrite the "Liquid Glass Theme" section (currently lines ~157-206) so it reads tokens (no `!important` where avoidable, no hardcoded pink):

```css
/* ── Liquid glass (token-driven) ── */
.flex.min-h-screen {
  background: var(--page-mesh);
}

[data-slot="card"] {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow), var(--glass-highlight);
}

[data-slot="card-footer"] {
  background: color-mix(in srgb, var(--glass-bg) 85%, transparent);
  border-top: 1px solid var(--glass-border);
}
```

- [ ] **Step 3: Delete the pink/blue override files and imports.**

```bash
git rm src/app/pink-buttons.css src/app/blue-theme.css
```

Then edit `src/app/layout.tsx` to remove lines 4-5:

```ts
import "./globals.css";
import "quill/dist/quill.snow.css";
```

- [ ] **Step 4: Replace the dark-mode override blob.** Delete the large `.arkiv-dashboard-theme[data-theme="dark"] …` block in `globals.css` (currently ~lines 310-433). Dark mode now comes from `[data-theme="dark"]` semantic tokens (Step 1). Keep the `color-scheme` hints:

```css
.arkiv-dashboard-theme { color-scheme: light; }
[data-theme="dark"] { color-scheme: dark; }
```

- [ ] **Step 5: Fix the button `outline` variant to use tokens** (remove hardcoded pink) in `src/components/ui/button.tsx:12-13`:

```ts
        outline:
          "border-primary/30 bg-background text-primary hover:!border-primary/50 hover:!bg-primary/5 aria-expanded:!border-primary/50 aria-expanded:!bg-primary/5",
```

- [ ] **Step 6: Verify build compiles and default look is preserved.**

Run: `npx next build`
Expected: build succeeds. Manually load `/dashboard` — default theme still reads as pink "Wonderland", cards still glassy.

- [ ] **Step 7: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx src/components/ui/button.tsx
git commit -m "feat(theme): add token layer, bind dark variant, remove hardcoded pink overrides"
```

---

### Task 5: ThemeProvider + anti-flash script + useTheme

**Files:**
- Create: `src/components/providers/theme-provider.tsx`
- Create: `src/components/providers/theme-script.tsx`
- Modify: `src/app/layout.tsx` (mount script in `<head>`, wrap children in `ThemeProvider`)
- Test: `src/components/providers/theme-provider.test.tsx`

**Interfaces:**
- Consumes: `THEME_STORAGE_KEY`, `DEFAULT_THEME_STATE`, `ThemeState`, `ThemeMode`, `parseThemeState`, `serializeThemeState`, `applyThemeState` (Task 3).
- Produces:
  - `<ThemeProvider>{children}</ThemeProvider>`
  - `useTheme(): { state: ThemeState; setState: (next: ThemeState) => void; setMode: (m: ThemeMode) => void; reset: () => void }`
  - `<ThemeScript />` — a blocking inline script element for `<head>`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/providers/theme-provider.test.tsx
import { act, render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY } from "@/lib/theme/theme-state";
import { ThemeProvider, useTheme } from "./theme-provider";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

describe("useTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies default theme to <html> on mount", () => {
    render(<ThemeProvider>x</ThemeProvider>);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(
      document.documentElement.style.getPropertyValue("--brand-primary")
    ).toBe("#db2777");
  });

  it("setMode persists and updates the attribute", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setMode("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toContain("dark");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/providers/theme-provider.test.tsx`
Expected: FAIL — cannot find module `./theme-provider`.

- [ ] **Step 3: Write the provider**

```tsx
// src/components/providers/theme-provider.tsx
"use client";

import * as React from "react";
import {
  applyThemeState,
  DEFAULT_THEME_STATE,
  parseThemeState,
  serializeThemeState,
  THEME_STORAGE_KEY,
  type ThemeMode,
  type ThemeState,
} from "@/lib/theme/theme-state";

type ThemeContextValue = {
  state: ThemeState;
  setState: (next: ThemeState) => void;
  setMode: (mode: ThemeMode) => void;
  reset: () => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [state, setStateRaw] = React.useState<ThemeState>(DEFAULT_THEME_STATE);

  React.useEffect(() => {
    const initial = parseThemeState(
      window.localStorage.getItem(THEME_STORAGE_KEY)
    );
    setStateRaw(initial);
    applyThemeState(document.documentElement, initial);
  }, []);

  const commit = React.useCallback((next: ThemeState) => {
    setStateRaw(next);
    applyThemeState(document.documentElement, next);
    window.localStorage.setItem(THEME_STORAGE_KEY, serializeThemeState(next));
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      state,
      setState: commit,
      setMode: (mode) => commit({ ...state, mode }),
      reset: () => commit(DEFAULT_THEME_STATE),
    }),
    [state, commit]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
```

- [ ] **Step 4: Write the anti-flash script**

```tsx
// src/components/providers/theme-script.tsx
import { THEME_STORAGE_KEY } from "@/lib/theme/theme-state";

const SCRIPT = `(function(){try{
var raw=localStorage.getItem('${THEME_STORAGE_KEY}');
var s=raw?JSON.parse(raw):null;
var mode=s&&['light','dark','auto'].indexOf(s.mode)>=0?s.mode:'light';
var root=document.documentElement;
root.setAttribute('data-theme',mode);
var p=(s&&typeof s.customPrimary==='string')?s.customPrimary:'#db2777';
var sec=(s&&typeof s.customSecondary==='string')?s.customSecondary:'#ec4899';
root.style.setProperty('--brand-primary',p);
root.style.setProperty('--brand-secondary',sec);
}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
```

- [ ] **Step 5: Wire into the root layout** (`src/app/layout.tsx`):

```tsx
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ThemeScript } from "@/components/providers/theme-script";
// ...
  return (
    <html lang="id">
      <head>
        <ThemeScript />
      </head>
      <body className={inter.className}>
        <ErrorBoundary>
          <ThemeProvider>
            <QueryProvider>
              <ActivityLogProvider>
                <ToastProvider>{children}</ToastProvider>
              </ActivityLogProvider>
            </QueryProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/components/providers/theme-provider.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/providers/theme-provider.tsx src/components/providers/theme-script.tsx src/components/providers/theme-provider.test.tsx src/app/layout.tsx
git commit -m "feat(theme): add ThemeProvider, useTheme, and anti-flash script"
```

---

### Task 6: Reduced-motion hook + motion primitives

**Files:**
- Create: `src/hooks/use-reduced-motion.ts`
- Create: `src/components/motion/motion-primitives.tsx`
- Create: `src/components/motion/index.ts`
- Test: `src/components/motion/motion-primitives.test.tsx`

**Interfaces:**
- Produces:
  - `useReducedMotion(): boolean`
  - `<FadeIn>` — opacity/translate entrance.
  - `<Pressable>` — scale-on-press wrapper (renders a `motion.div`).
  - `<PageTransition>` — route content fade/slide wrapper.
  - Barrel exports from `src/components/motion/index.ts`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/motion/motion-primitives.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FadeIn, PageTransition, Pressable } from "./motion-primitives";

describe("motion primitives", () => {
  it("renders children for each primitive", () => {
    render(
      <PageTransition>
        <FadeIn>
          <Pressable>
            <span>hello</span>
          </Pressable>
        </FadeIn>
      </PageTransition>
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/motion/motion-primitives.test.tsx`
Expected: FAIL — cannot find module `./motion-primitives`.

- [ ] **Step 3: Write the hook**

```ts
// src/hooks/use-reduced-motion.ts
import * as React from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}
```

- [ ] **Step 4: Write the primitives**

```tsx
// src/components/motion/motion-primitives.tsx
"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const EASE_GLASS = [0.32, 0.72, 0, 1] as const;

export function FadeIn({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE_GLASS, delay }}
    >
      {children}
    </motion.div>
  );
}

export function Pressable({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      whileTap={{ scale: 0.97 }}
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.12, ease: EASE_GLASS }}
    >
      {children}
    </motion.div>
  );
}

export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE_GLASS }}
    >
      {children}
    </motion.div>
  );
}
```

```ts
// src/components/motion/index.ts
export { FadeIn, Pressable, PageTransition } from "./motion-primitives";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/motion/motion-primitives.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-reduced-motion.ts src/components/motion/
git commit -m "feat(motion): add reduced-motion hook and motion primitives"
```

---

### Task 7: Tooltip primitive + role-aware HelpHint

**Files:**
- Create: `src/components/ui/tooltip.tsx`
- Create: `src/lib/help/help-content.ts`
- Create: `src/components/ui/help-hint.tsx`
- Test: `src/lib/help/help-content.test.ts`
- Test: `src/components/ui/tooltip.test.tsx`

**Interfaces:**
- Produces:
  - Tooltip parts: `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` (glass-styled).
  - `type HelpRole = "kasir" | "supervisor" | "kepala_cabang" | "direksi" | "default"`
  - `getHelpText(helpId: string, role: HelpRole): string | null`
  - `<HelpHint helpId="..." role={...} />` — an `i` icon that shows the resolved help text in a Tooltip.

- [ ] **Step 1: Write the failing help-content test**

```ts
// src/lib/help/help-content.test.ts
import { describe, expect, it } from "vitest";
import { getHelpText } from "./help-content";

describe("getHelpText", () => {
  it("returns role-specific text when available", () => {
    expect(getHelpText("pos.void", "supervisor")).toMatch(/PIN/i);
  });
  it("falls back to default text when role has no override", () => {
    expect(getHelpText("pos.void", "kasir")).toBe(
      getHelpText("pos.void", "default")
    );
  });
  it("returns null for unknown helpId", () => {
    expect(getHelpText("nope.nope", "default")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/help/help-content.test.ts`
Expected: FAIL — cannot find module `./help-content`.

- [ ] **Step 3: Write the help registry**

```ts
// src/lib/help/help-content.ts
export type HelpRole =
  | "kasir"
  | "supervisor"
  | "kepala_cabang"
  | "direksi"
  | "default";

type HelpEntry = Partial<Record<HelpRole, string>> & { default: string };

const HELP: Record<string, HelpEntry> = {
  "pos.shift": {
    default:
      "Buka shift sebelum bertransaksi. Semua penjualan Anda tercatat di bawah shift ini.",
    supervisor:
      "Pantau shift kasir aktif. Shift wajib dibuka sebelum transaksi dan ditutup saat tutup kasir.",
  },
  "pos.void": {
    default: "Membatalkan pesanan. Butuh otorisasi supervisor.",
    supervisor:
      "Masukkan PIN supervisor Anda untuk menyetujui pembatalan pesanan ini.",
    kepala_cabang:
      "Void memerlukan PIN supervisor; seluruh void tercatat di laporan untuk audit.",
  },
  "pos.split-bill": {
    default: "Pisahkan satu tagihan menjadi beberapa pembayaran terpisah.",
  },
  "pos.tax-toggle": {
    default: "Aktifkan/nonaktifkan pajak 10% pada transaksi ini.",
  },
  "pos.discount": {
    default:
      "Diskon otomatis mengikuti tier member (Silver 5%, Gold 10%, Platinum 15%).",
  },
  "report.closing.net-sales": {
    default: "Penjualan bersih = kotor − diskon − pajak − service charge.",
    kepala_cabang:
      "Bandingkan penjualan bersih terhadap target harian & bulanan cabang di bagian bawah laporan.",
    direksi:
      "Penjualan bersih lintas cabang menjadi dasar analisis margin di laporan profit.",
  },
};

export function getHelpText(helpId: string, role: HelpRole): string | null {
  const entry = HELP[helpId];
  if (!entry) return null;
  return entry[role] ?? entry.default;
}
```

- [ ] **Step 4: Run help-content test to verify it passes**

Run: `npx vitest run src/lib/help/help-content.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the Tooltip primitive** (verify `@base-ui/react/tooltip` exists; if not, fall back to a `Popover`-based hover implementation):

```tsx
// src/components/ui/tooltip.tsx
"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";

function TooltipProvider(props: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider delay={200} {...props} />;
}

function Tooltip(props: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root {...props} />;
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "side" | "sideOffset">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        className="isolate z-[9999]"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-[9999] max-w-[16rem] origin-(--transform-origin) rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-1.5 text-xs text-popover-foreground shadow-[var(--glass-shadow)] outline-hidden backdrop-blur-[var(--glass-blur)] duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
```

- [ ] **Step 6: Write the HelpHint**

```tsx
// src/components/ui/help-hint.tsx
"use client";

import { Info } from "lucide-react";
import { getHelpText, type HelpRole } from "@/lib/help/help-content";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export function HelpHint({
  helpId,
  role = "default",
  className,
}: {
  helpId: string;
  role?: HelpRole;
  className?: string;
}) {
  const text = getHelpText(helpId, role);
  if (!text) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Bantuan"
            className={cn(
              "inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-primary",
              className
            )}
          />
        }
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 7: Write the Tooltip render smoke test**

```tsx
// src/components/ui/tooltip.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelpHint } from "./help-hint";
import { TooltipProvider } from "./tooltip";

describe("HelpHint", () => {
  it("renders a help trigger when text exists", () => {
    render(
      <TooltipProvider>
        <HelpHint helpId="pos.void" role="supervisor" />
      </TooltipProvider>
    );
    expect(screen.getByLabelText("Bantuan")).toBeInTheDocument();
  });
  it("renders nothing for unknown helpId", () => {
    const { container } = render(
      <TooltipProvider>
        <HelpHint helpId="nope" />
      </TooltipProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 8: Run the tooltip test to verify it passes**

Run: `npx vitest run src/components/ui/tooltip.test.tsx`
Expected: PASS. (If `@base-ui/react/tooltip` is unavailable, implement `tooltip.tsx` on `@base-ui/react/popover` with `openOnHover`, then re-run.)

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/tooltip.tsx src/components/ui/help-hint.tsx src/lib/help/ src/components/ui/tooltip.test.tsx
git commit -m "feat(ui): add glass Tooltip primitive and role-aware HelpHint"
```

---

### Task 8: Appearance settings page + sidebar quick toggle + menu seed

**Files:**
- Create: `src/features/configuration/appearance/components/appearance-page.tsx`
- Create: `src/features/configuration/appearance/index.ts`
- Create: `src/app/dashboard/(dashboard)/settings/appearance/page.tsx`
- Modify: `src/components/shared/app-sidebar.tsx` (replace ad-hoc light/dark button; drive from `useTheme`)
- Modify: `database/seeders/iam-menus.sql` (add appearance menu under settings/business area)

**Interfaces:**
- Consumes: `useTheme` (Task 5), `THEME_PRESETS`/`getPreset` (Task 2), `resolveBrand`/`ThemeMode` (Task 3), `HelpHint` (Task 7), motion primitives (Task 6).
- Produces: `AppearancePage` React component (default export via `index.ts`).

- [ ] **Step 1: Build the Appearance page**

```tsx
// src/features/configuration/appearance/components/appearance-page.tsx
"use client";

import { Check, Moon, Monitor, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HelpHint } from "@/components/ui/help-hint";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FadeIn } from "@/components/motion";
import { useTheme } from "@/components/providers/theme-provider";
import { THEME_PRESETS } from "@/lib/theme/presets";
import { resolveBrand, type ThemeMode } from "@/lib/theme/theme-state";
import { cn } from "@/lib/utils";

const MODES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Terang", icon: Sun },
  { value: "dark", label: "Gelap", icon: Moon },
  { value: "auto", label: "Auto", icon: Monitor },
];

export function AppearancePage() {
  const { state, setState, setMode, reset } = useTheme();
  const brand = resolveBrand(state);

  return (
    <TooltipProvider>
      <FadeIn className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Tampilan</h1>
          <p className="text-sm text-muted-foreground">
            Sesuaikan tema warna dan mode terang/gelap aplikasi.
          </p>
        </div>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-medium">
            Mode <HelpHint helpId="appearance.mode" />
          </div>
          <div className="flex gap-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              const active = state.mode === m.value;
              return (
                <Button
                  key={m.value}
                  variant={active ? "default" : "outline"}
                  onClick={() => setMode(m.value)}
                >
                  <Icon className="size-4" /> {m.label}
                </Button>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 text-sm font-medium">Preset Tema</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {THEME_PRESETS.map((p) => {
              const active =
                state.presetId === p.id && !state.customPrimary;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    setState({
                      ...state,
                      presetId: p.id,
                      customPrimary: null,
                      customSecondary: null,
                    })
                  }
                  className={cn(
                    "relative flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-all hover:-translate-y-0.5",
                    active && "ring-2 ring-primary"
                  )}
                >
                  <span
                    className="size-8 rounded-full"
                    style={{
                      background: `linear-gradient(135deg, ${p.primary}, ${p.secondary})`,
                    }}
                  />
                  <span className="text-sm font-medium">{p.label}</span>
                  {active && (
                    <Check className="absolute right-2 top-2 size-4 text-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-medium">
            Warna Kustom <HelpHint helpId="appearance.custom" />
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
              Primary
              <input
                type="color"
                value={brand.primary}
                onChange={(e) =>
                  setState({ ...state, customPrimary: e.target.value })
                }
                className="h-10 w-16 cursor-pointer rounded-lg border border-input bg-transparent"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
              Secondary
              <input
                type="color"
                value={brand.secondary}
                onChange={(e) =>
                  setState({ ...state, customSecondary: e.target.value })
                }
                className="h-10 w-16 cursor-pointer rounded-lg border border-input bg-transparent"
              />
            </label>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button variant="outline" onClick={reset}>
            Reset ke Default
          </Button>
        </div>
      </FadeIn>
    </TooltipProvider>
  );
}
```

```ts
// src/features/configuration/appearance/index.ts
export { AppearancePage } from "./components/appearance-page";
```

- [ ] **Step 2: Add the route page**

```tsx
// src/app/dashboard/(dashboard)/settings/appearance/page.tsx
import { AppearancePage } from "@/features/configuration/appearance";

export default function Page() {
  return <AppearancePage />;
}
```

- [ ] **Step 3: Add help copy** for the two appearance helpIds in `src/lib/help/help-content.ts` (add to the `HELP` object):

```ts
  "appearance.mode": {
    default: "Auto mengikuti pengaturan terang/gelap perangkat Anda.",
  },
  "appearance.custom": {
    default:
      "Pilih warna primary & secondary; seluruh warna turunan dibuat otomatis dan tersimpan di perangkat ini.",
  },
```

- [ ] **Step 4: Replace the sidebar theme toggle.** In `src/components/shared/app-sidebar.tsx`, remove the local `theme` `useState`/`localStorage` effects (lines ~46-75) and drive `data-theme` from the provider instead. Change the wrapper `<div className="arkiv-dashboard-theme …" data-theme={theme} style={{ background: … }}>` to rely on the token background:

```tsx
    <div className="arkiv-dashboard-theme flex min-h-screen" style={{ background: "var(--page-mesh)" }}>
```

And replace the toggle button with one that calls `useTheme().setMode`, cycling light → dark → auto, wrapped in a `Tooltip`/`title="Ubah tema"`, linking the label to `/dashboard/settings/appearance`.

- [ ] **Step 5: Seed the appearance menu.** In `database/seeders/iam-menus.sql`, add an UPSERT row (follow the existing dot-notation + column pattern already in the file) for code `business.appearance` (or under the settings group), label `Tampilan`, route `/dashboard/settings/appearance`, an appropriate `order_number`, and grant it to all roles the same way sibling settings menus are granted.

- [ ] **Step 6: Verify**

Run: `npx next build`
Then manually: open `/dashboard/settings/appearance`, switch preset → whole UI recolors instantly; pick a custom primary → buttons/rings follow; toggle dark → tokens flip; reload → no flash, choice persists.

- [ ] **Step 7: Commit**

```bash
git add src/features/configuration/appearance/ "src/app/dashboard/(dashboard)/settings/appearance/" src/components/shared/app-sidebar.tsx src/lib/help/help-content.ts database/seeders/iam-menus.sql
git commit -m "feat(theme): add Appearance settings page, sidebar mode toggle, and menu seed"
```

---

# PHASE 1 — POS Pilot (prove the system end-to-end)

Phase 1 migrates the active POS surfaces to tokens + glass + motion + tooltips. These tasks
**modify large existing files**, so they follow a fixed **migration procedure** rather than
full-file rewrites.

## Migration procedure (apply per file)

1. **Color class remap** (find → replace within the file):
   - `bg-pink-600` / `bg-pink-500` (solid brand fills) → `bg-primary`
   - `text-pink-600` / `text-pink-700` → `text-primary`
   - `border-pink-200` / `border-pink-300` → `border-primary/30`
   - `bg-pink-50` (soft brand tint) → `bg-primary/10`
   - `ring-pink-*` → `ring-primary/40`
   - raw hex `#db2777` / `#ec4899` / `#be185d` in `style`/gradients → `var(--brand-primary)` / `var(--brand-secondary)`
   - `focus:ring-pink-500` → `focus-visible:ring-ring`
   - Leave semantic non-brand colors (gray, emerald for "success", red for "danger") as-is.
2. **Glass surfaces:** ad-hoc `bg-white shadow-lg` panels that should be glass → `bg-card` (inherits glass via `[data-slot="card"]`) or wrap with the `Card` component.
3. **Motion:** wrap the page's top-level content in `<PageTransition>`; wrap primary action buttons' click targets with `<Pressable>` only where it does not fight existing layout; add `transition-all` to interactive cards.
4. **Tooltips:** replace key `title="..."` on icon-only controls with `Tooltip`; add `<HelpHint helpId=... role={role} />` next to the controls listed per task. Resolve `role` from the page's known user role (`pos` → `kasir`, `pos_supervisor` → `supervisor`, `direksi` → `direksi`).
5. **Verify:** `npx next build` compiles; the page renders identically under the default Wonderland preset, recolors under a different preset, and is legible in dark mode.

### Task 9: Migrate Cashier page (embedded + fullscreen)

**Files:**
- Modify: `src/features/pos/cashier/components/cashier-page.tsx`
- Modify (if pink present): `src/components/pos/*` used by cashier (`CartPanel`, `PaymentModal`, `ShiftModal`, `SplitBillModal`, `CustomizationModal`, `NFCModal`)

**Interfaces:**
- Consumes: `PageTransition`, `Pressable` (Task 6); `Tooltip*`, `HelpHint` (Task 7).

- [ ] **Step 1:** Apply the migration procedure color remap across `cashier-page.tsx` and the `src/components/pos/*` files it imports.
- [ ] **Step 2:** Wrap the cashier layout root in `<PageTransition>`; ensure the fullscreen toggle button (lines ~705-725) still works.
- [ ] **Step 3:** Add `HelpHint` (with `role` derived from user) beside: open-shift control (`helpId="pos.shift"`), tax toggle (`"pos.tax-toggle"`), discount indicator (`"pos.discount"`), split-bill button (`"pos.split-bill"`).
- [ ] **Step 4:** Ensure every mutation button (checkout, save open bill, pay) already shows loading + toast per `ui-interaction-standards`; leave logic untouched.
- [ ] **Step 5: Verify**

Run: `npx next build` and manually exercise `/dashboard/pos/cashier-new` and `/dashboard/pos/cashier-fullscreen`.
Expected: unchanged behavior; recolors with preset; readable in dark.

- [ ] **Step 6: Commit**

```bash
git add src/features/pos/cashier/ src/components/pos/
git commit -m "refactor(pos): migrate cashier to design tokens, glass, motion, tooltips"
```

### Task 10: Migrate POS Dashboard

**Files:**
- Modify: `src/features/pos/dashboard/components/pos-dashboard-page.tsx`
- Modify: `src/features/pos/dashboard/components/pos-dashboard-charts.tsx`

**Interfaces:** Consumes `PageTransition`, `FadeIn` (Task 6); `HelpHint` (Task 7).

- [ ] **Step 1:** Apply the color remap to both files.
- [ ] **Step 2:** For ApexCharts, replace hardcoded pink series colors with brand values read at runtime:
  `getComputedStyle(document.documentElement).getPropertyValue("--brand-primary").trim()` (compute inside a `useEffect`/`useMemo` on the client), with `--brand-secondary` for the second series.
- [ ] **Step 3:** Wrap the KPI card grid entrance in `<FadeIn>` (stagger via `delay` per card, capped at ~6 cards); wrap page root in `<PageTransition>`.
- [ ] **Step 4:** Add `HelpHint` next to metric labels where a kepala-cabang/direksi explanation helps (e.g., AOV, active cashiers) using `role`.
- [ ] **Step 5: Verify** `npx next build` + manual `/dashboard/pos`.
- [ ] **Step 6: Commit**

```bash
git add src/features/pos/dashboard/
git commit -m "refactor(pos): migrate POS dashboard to tokens, brand-driven charts, motion"
```

### Task 11: Migrate Closing & Profit reports

**Files:**
- Modify: `src/features/pos/reports/components/closing-report-page.tsx`
- Modify: `src/features/pos/reports/components/profit-report-page.tsx`
- Modify: `src/features/pos/reports/components/profit-report-charts.tsx`
- Modify: `src/features/pos/reports/components/apex-chart.tsx`

**Interfaces:** Consumes `PageTransition`, `FadeIn` (Task 6); `Tooltip*`, `HelpHint` (Task 7).

- [ ] **Step 1:** Apply the color remap across all four files.
- [ ] **Step 2:** Keep the closing report's **monospace printable** section visually unchanged for print; only restyle the on-screen chrome (filters, cards) with tokens/glass. Ensure print styles don't inherit glass blur (wrap screen-only chrome so `@media print` stays clean).
- [ ] **Step 3:** Brand-drive chart colors as in Task 10 Step 2.
- [ ] **Step 4:** Add `HelpHint` on closing-report figures using role-aware copy: net sales (`"report.closing.net-sales"`), plus targets. Use `role="kepala_cabang"`/`"direksi"` where the page is used by those roles.
- [ ] **Step 5: Verify** `npx next build` + manual `/dashboard/pos/reports/closing` and `/dashboard/pos/reports/profit`, including a print preview of the closing report.
- [ ] **Step 6: Commit**

```bash
git add src/features/pos/reports/
git commit -m "refactor(pos): migrate closing & profit reports to tokens, glass, tooltips"
```

---

### Task 12: Update design guidance docs & add regression gate

**Files:**
- Modify: `.pi/skills/arkiv-ui-design/SKILL.md`
- Modify: `.cursor/rules/ui-interaction-standards.mdc`
- Create: `scripts/check-no-hardcoded-brand.mjs`

**Interfaces:** Produces a grep-style gate that fails if raw brand hex reappears in `src/`.

- [ ] **Step 1:** Rewrite the color sections of `arkiv-ui-design/SKILL.md` to describe token-based theming: primary comes from `--brand-primary`/`bg-primary`, never a hardcoded hex; pink is only the default preset value.
- [ ] **Step 2:** Update `ui-interaction-standards.mdc` to reference semantic tokens (`bg-primary`, `border-border`, `text-muted-foreground`) instead of pink specifics; keep the soft-border and DialogPanel rules.
- [ ] **Step 3:** Add the gate script:

```js
// scripts/check-no-hardcoded-brand.mjs
import { execSync } from "node:child_process";

const BANNED = ["#db2777", "#ec4899", "#be185d", "#ff00aa"];
const pattern = BANNED.join("|");
let out = "";
try {
  out = execSync(
    `git grep -nE "${pattern}" -- src ':!src/lib/theme/presets.ts'`,
    { encoding: "utf8" }
  );
} catch {
  // git grep exits non-zero when there are no matches → clean
}
if (out.trim()) {
  console.error("Hardcoded brand hex found (use tokens instead):\n" + out);
  process.exit(1);
}
console.log("OK: no hardcoded brand hex in src/.");
```

- [ ] **Step 4:** Run the gate.

Run: `node scripts/check-no-hardcoded-brand.mjs`
Expected: OK once Phase 1 files are migrated (allowed only in `presets.ts`).

- [ ] **Step 5: Commit**

```bash
git add .pi/skills/arkiv-ui-design/SKILL.md .cursor/rules/ui-interaction-standards.mdc scripts/check-no-hardcoded-brand.mjs
git commit -m "docs(theme): token-based design guidance + hardcoded-brand gate"
```

---

## Deferred to follow-on plans (Phase 2 & 3)

These get their own dated plans once the foundation lands, each independently testable:

- **Phase 2 — Shared component sweep plan:** migrate remaining pink in `src/components/ui/*`
  and `src/components/design-system/*` to tokens; add glass to popover/dropdown/select/sheet/
  tabs/toast; wire `Pressable`/press states into `Button`.
- **Phase 3 — Module sweep plans (one per module):** purchasing, inventory, HRIS, CRM,
  configuration/settings, auth/login, arkiv-os desktop — each applying the same Task-9-style
  migration procedure and ending with the regression gate passing for that scope.

---

## Self-Review

**Spec coverage:**
- Token architecture → Tasks 1-4 ✅
- Theme customization feature (presets + custom + light/dark/auto, localStorage, anti-flash) → Tasks 2, 3, 5, 8 ✅
- Liquid glass (token-driven) → Task 4 (globals) + Phase 1 migration ✅ (component-wide glass in deferred Phase 2)
- Motion system (tokens, framer-motion + tw-animate-css, reduced-motion) → Task 4 (import + reduced-motion CSS) + Task 6 ✅
- Tooltip + role-aware help → Task 7, applied in Tasks 9-11 ✅
- Strangle hardcoded pink → Task 4 + migration procedure + Task 12 gate ✅
- Rollout phases → Phase 0/1 here; Phase 2/3 deferred with explicit follow-on plans ✅
- Verification → per-task builds + vitest + regression gate ✅

**Placeholder scan:** No "TBD"/"implement later". Migration tasks (9-11) reference a concrete
shared procedure with exact class mappings rather than fabricated full-file code, because they
edit large pre-existing files; each still ends in a build + commit deliverable.

**Type consistency:** `ThemeState`, `ThemeMode`, `BrandVars`, `HelpRole`, `ThemePreset`,
`applyThemeState`, `resolveBrand`, `buildBrandVars`, `getHelpText` names are used consistently
across Tasks 1-8. `useTheme` returns `{ state, setState, setMode, reset }` and is consumed with
those exact names in Task 8.

**Known verification point:** Task 7 assumes `@base-ui/react/tooltip` exists; Step 8 includes
the popover-based fallback if it does not.
