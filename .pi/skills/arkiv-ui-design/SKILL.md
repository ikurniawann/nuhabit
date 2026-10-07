---
name: arkiv-ui-design
description: Enforces the Arkiv OS liquid glass design system with token-based brand theming, glassmorphism cards, and soft pastel mesh backgrounds. Use whenever creating or modifying any React component, page, or layout in the Arkiv OS project. Prevents hardcoded brand colors, generic blue buttons, flat white cards, and dark heavy borders.
---

# Arkiv UI Design Skill

## Overview

Arkiv OS is an ERP system for Aapex Technology with a premium "Apple-style liquid glass" aesthetic. The POS sub-brand uses "Prologue in Wonderland" identity, but brand color must come from theme tokens so each tenant/preset can change it without code edits. Every UI element must match this visual language: no generic Tailwind defaults and no raw brand hex in components.

## Color System (MANDATORY)

### Brand Tokens
- Primary brand color comes from `--brand-primary`, exposed through semantic tokens such as `--primary`, `bg-primary`, `text-primary`, `border-primary`, and `ring-primary`.
- Secondary brand color comes from `--brand-secondary` and derived token scales in `src/app/globals.css`.
- Use semantic foreground utilities such as `text-primary-foreground`, `text-foreground`, and `text-muted-foreground` for readable contrast.
- Never hardcode Arkiv brand hex values in React components, CSS modules, or feature code. If a color needs to follow the brand, use tokens.
- Pink is only the default Wonderland preset value in the theme source of truth; it is not a component-level design requirement.

### Background — Soft Pastel Mesh
- Page background: use the tokenized page mesh (`--page-mesh`) or existing app shell background utilities.
- Sidebar: use the shared sidebar/app shell styles and semantic foreground tokens; avoid pure black.
- Card glass: use the liquid glass variables (`--glass-bg`, `--glass-border`, `--glass-shadow`) or established `bg-card`/glass utilities.
- Card footer: use subtle semantic surfaces such as `bg-muted/50`.

### Borders & Surfaces
- Border: prefer `border-border`, `border-gray-200/70`, or tokenized glass borders.
- Input border: use `border-input` with subtle `focus:ring-1 focus:ring-primary/30` or local shared input styles.
- Input bg: use `bg-background`, `bg-card`, or glass surfaces.
- Error state: use semantic destructive tokens (`text-destructive`, `border-destructive/30`, `bg-destructive/10`) unless a local component has a more specific established pattern.

## Liquid Glass Card Rules

```css
background: rgba(255, 255, 255, 0.70);
backdrop-filter: blur(24px) saturate(1.8);
border: 1px solid rgba(209, 213, 219, 0.35);
box-shadow:
  0 2px 20px rgba(0, 0, 0, 0.04),
  0 1px 4px rgba(0, 0, 0, 0.03),
  inset 0 1px 0 rgba(255, 255, 255, 0.85);
border-radius: 1rem;
```

## Typography
- Base: Inter (Google Fonts)
- Accent: Roundo (Fontshare, career section only)
- Label style: `text-xs font-medium text-gray-500 uppercase tracking-wide mb-2`
- Headings: bold but not oversized

## Iconography
- Library: Lucide React (`lucide-react`)
- Input icons: `h-5 w-5 text-gray-400`
- Sidebar icons: `text-white`

## Forbidden Patterns (Anti-Generic)

| ❌ NEVER | ✅ ALWAYS |
|---|---|
| `bg-blue-600` button | Tokenized brand action: `bg-primary text-primary-foreground` |
| Flat white card (`bg-white shadow-lg`) | Liquid glass card with backdrop blur |
| `border-gray-900` / thick dark borders | `border-border`, `border-gray-200/70`, or tokenized glass borders |
| Pure black sidebar `#000000` | Shared sidebar/app shell styles with semantic foreground tokens |
| Hardcoded brand hex in components | `bg-primary`, `text-primary`, `ring-primary`, CSS vars |
| Hard shadow | Multi-layer soft shadow |
| Generic gray input | `bg-background/70 border-input focus:ring-primary/30` |

## POS / Prologue in Wonderland Notes
- Logo: `public/logo.png`
- Currency display: `Rp X (Y ARK)` where 1 ARK = Rp 1000
- Can be more playful with gradients and badges
- Still MUST use liquid glass in modals/forms

## Reference Files
- `src/app/(auth)/login/page.tsx` — Login page as design reference
- `src/app/globals.css` — Token layer, glass, dark-mode compatibility, animations
- `src/lib/theme/` — Presets, palette, theme state
- `src/components/providers/theme-provider.tsx` — Runtime theme application
- `src/features/configuration/appearance/` — Appearance settings UI
- `src/components/ui/button.tsx` — Base button component
- `scripts/check-no-hardcoded-brand.mjs` — Phase-1 brand-hex regression gate

## Checklist Before Sending UI Code
- [ ] Primary button uses `bg-primary text-primary-foreground` or the shared button variant
- [ ] Card uses backdrop-blur + bg-white/70 + subtle border
- [ ] Page background is pastel mesh gradient
- [ ] Labels are `text-xs uppercase tracking-wide text-gray-500`
- [ ] Inputs are rounded-lg with subtle tokenized focus ring
- [ ] No thick dark borders on tables
- [ ] Sidebar uses the shared app shell/sidebar styles
- [ ] Error states use destructive semantic tokens
- [ ] All icons are Lucide with consistent sizing
- [ ] NO `bg-blue-600` anywhere
- [ ] NO hardcoded brand hex in component code
