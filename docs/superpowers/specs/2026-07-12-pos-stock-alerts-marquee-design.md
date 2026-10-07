# POS Stock Alerts — Top Marquee Ticker

- **Date:** 2026-07-12
- **Status:** Approved — implemented
- **Author:** AI + product owner (brainstorming session)
- **Scope:** Add a continuous horizontal alert ticker at the top of `/dashboard/pos/stock-alerts`

---

## 1. Context & Problem

`StockAlertsPage` is a dark full-screen TV-style display: header, two scrollable columns (raw materials + products at risk / POS), footer with auto-refresh. Staff glancing at a wall display need a high-visibility running strip of alerts without reading every card.

**Decisions (brainstorming):**
- Form: horizontal ticker (not vertical auto-scroll of cards)
- Placement: strip **above** the existing header (top of viewport)
- Content: short `Nama · STATUS` only (not qty / BOM detail)
- Implementation: CSS infinite marquee (duplicate track + `translateX(-50%)`), same idea as career page marquee

---

## 2. Goals

- Show a looping marquee of all current stock alerts (raw materials, products at risk, POS products).
- Keep the existing two-column card layout and 15s auto-refresh unchanged.
- Stay readable on TV: high contrast, no interaction required.
- Respect `prefers-reduced-motion: reduce` (static truncated line instead of animation).

## 3. Non-goals

- New API or polling interval
- Replacing the card lists
- Pause-on-hover / click-to-open item
- Native `<marquee>` element
- Changing IAM / routes / menus

---

## 4. UX

### Placement

1. **Marquee strip** — full width, ~36–40px tall, first child inside the page shell (above header)
2. Existing header (title + refresh) — unchanged
3. Main grid + footer — unchanged

### Content format

Each segment: `Nama · STATUS`

| Source | `Nama` | `STATUS` |
|--------|--------|----------|
| Raw material | `item.nama` | `item.status_stok` (e.g. HABIS / MENIPIS) |
| Product at risk | `item.nama` | `{max_servings} porsi` |
| POS product | `item.name` | `HABIS` if `current <= 0`, else `MENIPIS` |

Segments separated by a bullet or middot with spacing, e.g. `Gula · HABIS  •  Tepung · MENIPIS  •  Latte · 2 porsi`.

**Sort order:** all `critical` first (raw → products → POS within level), then `warning` in the same source order.

**Empty state:** no animation; centered or left-aligned static text: `Semua stok aman`.

### Visual

- Background: dark strip with soft amber/red tint when any critical alert exists (`bg-red-950/80` if any critical, else `bg-amber-950/50` or `bg-gray-900`)
- Text: small semibold, `text-red-200` / `text-amber-200` / white depending on strip state; monospace optional for status tokens
- Soft bottom border (`border-gray-800` or `border-red-900/50`) — no black hard borders
- Overflow hidden; duplicated track for seamless loop

### Motion

- CSS `@keyframes` translating track by `-50%` (duplicated content)
- Duration: fixed **40s** linear infinite (same order of magnitude as career marquee; readable on TV)
- `prefers-reduced-motion: reduce`: disable animation; show single static row with `truncate` / ellipsis

---

## 5. Architecture

### Files

| File | Change |
|------|--------|
| `src/features/pos/stock-alerts/components/stock-alerts-page.tsx` | Render marquee strip; build ticker segments from `data` |
| `src/features/pos/stock-alerts/ticker.ts` (or colocated helper) | Pure helper: alerts → ordered segment strings |
| Optional: scoped keyframes in component via Tailwind `animate-*` + `globals.css` class (e.g. `stock-alerts-marquee`) mirroring `career-marquee` | Prefer a dedicated class so career marquee timing stays independent |

### Data flow

```
useStockAlerts(15000)
  → raw_materials / products_at_risk / pos_products
  → buildStockAlertTickerSegments(...)
  → StockAlertMarquee (inline or small component)
```

No new fetch. When `data` updates, React re-renders the duplicated track; animation continues.

### Testing

- Unit test helper: ordering (critical before warning), format strings, empty → empty array
- Manual: TV layout, empty state, reduced-motion if easy to check

---

## 6. Error / edge cases

| Case | Behavior |
|------|----------|
| Loading, no data yet | Hide marquee strip until first successful payload |
| Error banner | Marquee still shows last successful segments if any; else empty/safe message |
| Single short item | Still duplicate track so loop works; or pad with separators — duplicate is enough |
| Very long names | Allow natural length in marquee (no truncate on moving track) |

---

## 7. Success criteria

- Opening `/dashboard/pos/stock-alerts` shows a top strip that continuously scrolls alert name+status.
- Cards and auto-refresh behave as today.
- Zero alerts → static “Semua stok aman”.
- Reduced motion → no continuous scroll.

---

## 8. Addendum — Vertical column marquee (2026-07-12)

**Decisions:** Both columns (raw materials + products/POS). Animate **only when content overflows** the column viewport. CSS `translateY(-50%)` + duplicated track; `ResizeObserver` gates animation via `shouldAnimateVerticalMarquee`. Duration **50s**. Reduced motion → no duplicate/animation; normal overflow scroll.

**Files:** `vertical-marquee.ts`, `components/vertical-marquee-list.tsx`, `globals.css` (`.stock-alerts-marquee-y`).
