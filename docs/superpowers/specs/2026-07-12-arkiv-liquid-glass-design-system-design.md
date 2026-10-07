# Arkiv OS — Liquid Glass Design System Revamp + Theme Customization

- **Date:** 2026-07-12
- **Status:** Draft for approval
- **Author:** AI + product owner (brainstorming session)
- **Scope:** Whole application (foundation is global; per-module polish is phased)

---

## 1. Context & Problem

Arkiv OS is an integrated ERP for restaurant/café operations (Next.js 16, React 19,
Tailwind v4 CSS-first, shadcn "base-nova" on `@base-ui/react` + CVA, PostgreSQL).
Modules: POS/Cashier, HRIS, Purchasing, Inventory, CRM/Loyalty, Items, Configuration/IAM.

**Current active checkpoint (git status):** POS work — `cashier-new`, `cashier-fullscreen`,
POS dashboard charts, closing report (tutup kasir), profit report.

### Reverse-engineered user story (roles to serve)

- **Kasir (`pos`)** — open shift, dine-in/takeaway orders, table pick, attach member (tier
  discount + ARK Coin), split bill, open bill, checkout + thermal receipt (embedded/fullscreen).
- **Supervisor (`pos_supervisor`)** — authorize voids via PIN, oversee cashier ops.
- **Kepala cabang / Direksi (`direksi`)** — cross-module dashboard + POS reports (profit &
  closing), read-only.

### Problems with the current design system

1. **Brand color is hardcoded hot-pink with `!important`** across `src/app/pink-buttons.css`,
   `src/app/blue-theme.css`, and `src/app/globals.css`. This makes true theme customization
   impossible — any user-chosen color would be overridden by pink.
2. **No brand CSS variables / design tokens.** shadcn semantic classes (`bg-primary`,
   `text-muted-foreground`, `border-input`) are referenced by components but **never defined**
   in checked-in CSS. Styling is driven by ad-hoc utilities + `!important` overrides.
3. **No color theme customization feature.** Only a light/dark toggle (a fragile
   `!important` override blob keyed on `.arkiv-dashboard-theme[data-theme="dark"]`, persisted
   in `localStorage`) and an Arkiv OS wallpaper picker exist.
4. **No shared Tooltip component.** Only native HTML `title` attributes + chart tooltips.
5. **Motion libraries are installed but unused:** `framer-motion` (toast only) and
   `tw-animate-css` (installed but **not imported** anywhere).

---

## 2. Goals & Non-Goals

### Goals

- Re-architect the design system around a **three-layer CSS variable token system** so the
  whole app themes from a small set of brand inputs.
- Deliver an **App Theme Customization** feature: presets + custom primary/secondary color,
  light/dark/auto mode, per-user persistence via `localStorage`.
- Refine the **liquid glass** aesthetic toward iOS / ColorOS references, token-driven.
- Add a **centralized motion system** (subtle, smooth, `prefers-reduced-motion`-aware,
  low-end friendly).
- Add a **Tooltip + role-aware contextual help** system for kasir/supervisor/kepala
  cabang/direksi.
- **Strangle** all hardcoded pink `!important` overrides; keep pink "Wonderland" as the
  default preset (now overridable).

### Non-Goals

- No changes to business logic, data flow, API contracts, or routes.
- No breaking changes to component public APIs (e.g., `DialogPanel` structure stays stable).
- No new runtime dependencies (`framer-motion`, `tw-animate-css`, `@base-ui/react`, `cva`
  are already installed).
- No per-branch/tenant DB theming (per-user `localStorage` only, per decision).

---

## 3. Key Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Pilot scope | Whole app; foundation global, rollout phased (POS active surfaces first) |
| Theme control & persistence | Per-user, `localStorage` (no DB changes) |
| Customization granularity | Presets + custom **primary & secondary**; system auto-generates shades + glass variants |
| Light/dark | Re-architect both via tokens; custom colors apply to both; add **Auto/System** |
| Tooltip model | Shared glass Tooltip primitive + contextual help icons + **role-aware** copy |
| Motion | Centralized tokens (framer-motion + tw-animate-css); subtle; respect reduced-motion; light on low-end |
| Default brand | Keep hot-pink "Wonderland" as default preset, now token-based & overridable |
| Architecture approach | **A — Full token re-architecture + strangler of `!important` pink** |

---

## 4. Architecture

### 4.1 Token layer (three tiers)

All tokens defined in `src/app/globals.css` (Tailwind v4 `@theme` + `:root` / `[data-theme]`),
consumed via existing shadcn semantic classes.

**Tier 1 — Primitive inputs (user-controllable):**
- `--brand-primary`, `--brand-secondary` (only two required inputs).

**Tier 2 — Derived scales (auto-generated in JS, written as CSS vars):**
- `--primary-50 … --primary-950`, `--secondary-50 … --secondary-950`.
- `--primary-foreground`, `--secondary-foreground` (WCAG-contrast chosen, prevents unreadable
  buttons when a light brand color is picked).

**Tier 3 — Semantic tokens (consumed by components):**
- Color: `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`,
  `--popover-foreground`, `--muted`, `--muted-foreground`, `--border`, `--input`, `--ring`,
  `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`,
  `--accent`, `--destructive`, `--success`, `--warning`.
- Glass: `--glass-bg`, `--glass-border`, `--glass-blur`, `--glass-saturate`, `--glass-shadow`,
  `--glass-highlight`.
- Shape/motion: `--radius`, `--dur-fast`, `--dur-base`, `--dur-slow`, `--ease-glass`, `--ease-out`.

**Light/dark:** semantic tokens defined twice — `:root` (light) and `[data-theme="dark"]`
(dark) — both derived from the same brand inputs. `Auto` uses `data-theme="auto"` +
`@media (prefers-color-scheme: dark)`.

### 4.2 Palette generation

`src/lib/theme/palette.ts` — **pure, unit-tested** function:
`generatePalette({ primary, secondary }) → Record<cssVarName, value>`.
- Ramps lightness in OKLCH for perceptually even 50–950 scales.
- Computes foreground color via contrast ratio (target ≥ 4.5:1 for text on brand fills).
- Derives glass tint tokens for light and dark.

`src/lib/theme/presets.ts` — preset definitions: **Wonderland** (pink default: `#db2777` /
`#ec4899` / `#be185d`), **Ocean**, **Emerald**, **Graphite**, **Sunset**.

### 4.3 Theme provider & persistence

- `src/components/providers/theme-provider.tsx` (client): holds theme state
  `{ presetId, customPrimary?, customSecondary?, mode: 'light'|'dark'|'auto' }`, persists to
  `localStorage` key `arkiv-theme`, applies generated CSS vars via
  `document.documentElement.style.setProperty(...)` and sets `data-theme`.
- **Anti-flash:** a small blocking inline script injected in the root layout `<head>` reads
  `localStorage.arkiv-theme` and sets `data-theme` + core vars **before first paint**.
- Exposes `useTheme()` hook for the settings UI.

### 4.4 Theme customization UI

- New page: `/dashboard/settings/appearance` (feature dir
  `src/features/configuration/appearance/`). Add an IAM menu entry in
  `database/seeders/iam-menus.sql` (visible to all authenticated roles).
- Controls: mode toggle (Light/Dark/Auto), preset gallery (live glass swatches), custom
  primary & secondary color pickers with **instant live preview**, reset-to-default.
- Sidebar quick toggle: replace current ad-hoc light/dark button with a control that links to
  Appearance and offers a one-tap mode switch.

### 4.5 Liquid glass layer

- Rewrite glass rules in `globals.css` to be **token-driven** (`--glass-*`), refined toward
  iOS/ColorOS: layered translucency, vibrancy (`saturate`), specular top highlight, hairline
  border, adaptive across light/dark.
- New primitive `src/components/ui/glass-surface.tsx` (`GlassSurface`) for reuse.
- Applied (restyle only, APIs unchanged) to: card, `DialogPanel`, popover, dropdown-menu,
  select, sheet, sidebar, toast, tabs, input.
- Tables/large lists stay performance-safe: glass header + soft rows, **no per-row
  backdrop-blur**.

### 4.6 Motion system

- Motion tokens in `globals.css`; `@import "tw-animate-css"` added.
- `src/components/motion/`: `PageTransition`, `FadeIn`, `Pressable`, presence helpers for
  modals/toasts, opt-in capped list stagger.
- Micro-interactions: button press/hover, card hover lift, tab underline slide, dialog
  scale+fade, origin-aware popover.
- `prefers-reduced-motion` respected globally (hook + CSS fallback); animate only
  `transform`/`opacity`; never animate `blur`/layout on low-end paths.

### 4.7 Tooltip + contextual help

- `src/components/ui/tooltip.tsx` — built on `@base-ui/react`, glass-styled, accessible
  (hover + keyboard focus + long-press on touch).
- `HelpHint` component (`i`/`?` icon) surfaces contextual help.
- `src/lib/help/help-content.ts` — help registry keyed by `helpId` + role
  (`kasir` | `supervisor` | `kepala_cabang` | `direksi` | `default`). `HelpHint` reads the
  current user role and renders the relevant copy.
- Progressive migration of key native `title=""` attributes to `Tooltip`; seed help hints on
  critical POS controls (open shift, void, split bill, discount, tax toggle, closing-report
  fields).

### 4.8 Strangling hardcoded pink

- Delete `src/app/pink-buttons.css` and `src/app/blue-theme.css`; remove imports in
  `src/app/layout.tsx`.
- Replace `!important` pink blocks in `globals.css` with token-based rules (no `!important`).
- Sweep inline `bg-pink-*` / `text-pink-*` / raw hex (`#db2777`, `#ec4899`, `#be185d`, etc.)
  across `src/features/**` and `src/components/**` → semantic token classes
  (`bg-primary`, `text-primary`, `border-border`, …). This is the bulk per-module effort.
- Update `.pi/skills/arkiv-ui-design/SKILL.md` and
  `.cursor/rules/ui-interaction-standards.mdc` to describe token-based theming instead of
  "mandatory hot pink".

---

## 5. Rollout Phases

- **Phase 0 — Global foundation:** token layer, `ThemeProvider`, `palette.ts`, presets,
  anti-flash script, Appearance page, `Tooltip` primitive, motion primitives.
- **Phase 1 — Pilot (POS active surfaces):** Cashier (embedded + fullscreen), POS Dashboard,
  Closing & Profit reports — full token + glass + motion + tooltip migration.
- **Phase 2 — Shared components sweep:** button, card, dialog, input, table, badge, select,
  popover, dropdown, sheet, tabs, toast.
- **Phase 3+ — Module-by-module inline pink sweep:** purchasing, inventory, HRIS, CRM,
  settings, auth/login, arkiv-os desktop.

---

## 6. Testing & Verification

- **Unit (vitest, already configured):** `palette.ts` (scale monotonicity, contrast targets),
  theme-provider state/persistence logic, help-content role resolution.
- **Visual QA checklist** per phase (light + dark + a custom color).
- **Accessibility:** contrast ≥ 4.5:1 on brand fills, keyboard-reachable tooltips,
  `prefers-reduced-motion` honored.
- **Regression gate:** grep gate ensuring no `!important` pink / raw brand hex remain in
  migrated scopes.
- **Build/lint:** `next build` + `eslint` green; no new dependencies added.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Visual regressions across ~203 pages | Phased rollout; pilot POS first; default preset reproduces current pink look |
| SSR theme flash | Blocking inline script sets vars before paint |
| Unreadable buttons on light custom colors | Contrast-based `foreground` derivation in `palette.ts` |
| Backdrop-blur perf on cashier tablets | No per-row blur; transform/opacity-only motion; reduced-motion support |
| `!important` removal breaking niche styles | Token rules replace them 1:1; grep gate + per-phase QA |

---

## 8. Affected / New Files (indicative)

**New:** `src/lib/theme/palette.ts`, `src/lib/theme/presets.ts`,
`src/components/providers/theme-provider.tsx`, `src/components/ui/tooltip.tsx`,
`src/components/ui/glass-surface.tsx`, `src/components/motion/*`,
`src/lib/help/help-content.ts`, `src/components/ui/help-hint.tsx`,
`src/features/configuration/appearance/*`,
`src/app/dashboard/(dashboard)/settings/appearance/page.tsx`.

**Modified:** `src/app/globals.css`, `src/app/layout.tsx`,
`src/components/shared/app-sidebar.tsx`, shared `src/components/ui/*`,
`database/seeders/iam-menus.sql`, `.pi/skills/arkiv-ui-design/SKILL.md`,
`.cursor/rules/ui-interaction-standards.mdc`, plus per-module feature files during sweep.

**Deleted:** `src/app/pink-buttons.css`, `src/app/blue-theme.css`.
