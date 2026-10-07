# POS Stock Alerts Marquee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CSS infinite horizontal ticker strip above the Stock Alerts page header showing `Nama · STATUS` for all alerts.

**Architecture:** Pure helper `buildStockAlertTickerSegments` maps API payload → ordered segment strings. Page renders a top strip with duplicated track + `stock-alerts-marquee` CSS keyframes (40s). No API changes.

**Tech Stack:** React client component, Vitest, Tailwind + `globals.css` keyframes

## Global Constraints

- Format: `Nama · STATUS` only (spec §4)
- Sort: critical first (raw → products → POS), then warning same source order
- Empty: static `Semua stok aman`; hide strip until first successful `data`
- Motion: 40s linear infinite; `prefers-reduced-motion` → static truncate
- No new API / IAM / routes

---

### Task 1: Ticker segment helper (TDD)

**Files:**
- Create: `src/features/pos/stock-alerts/ticker.ts`
- Test: `src/features/pos/stock-alerts/ticker.test.ts`

**Interfaces:**
- Consumes: `RawMaterialAlert`, `ProductAtRiskAlert`, `PosProductStockAlert` from `./types`
- Produces:
  ```ts
  export type StockAlertTickerInput = {
    raw_materials: RawMaterialAlert[];
    products_at_risk: ProductAtRiskAlert[];
    pos_products: PosProductStockAlert[];
  };
  export function buildStockAlertTickerSegments(input: StockAlertTickerInput): string[];
  export function hasCriticalStockAlert(input: StockAlertTickerInput): boolean;
  ```

- [x] **Step 1: Write failing tests** for empty → `[]`, format strings, critical-before-warning order, POS HABIS/MENIPIS
- [x] **Step 2: Run** `npx vitest run src/features/pos/stock-alerts/ticker.test.ts` — expect FAIL
- [x] **Step 3: Implement** `ticker.ts`
- [x] **Step 4: Run tests** — expect PASS

---

### Task 2: CSS marquee class

**Files:**
- Modify: `src/app/globals.css` (near `career-marquee`)

- [x] **Step 1: Add** `@keyframes stock-alerts-marquee` (`0%` → `100%` `translateX(-50%)`) and `.stock-alerts-marquee { animation: stock-alerts-marquee 40s linear infinite; }`
- [x] **Step 2: Add** `@media (prefers-reduced-motion: reduce) { .stock-alerts-marquee { animation: none; } }`

---

### Task 3: Wire marquee into StockAlertsPage

**Files:**
- Modify: `src/features/pos/stock-alerts/components/stock-alerts-page.tsx`

- [x] **Step 1: Import** helpers; when `data` exists, compute segments + `hasCritical`
- [x] **Step 2: Render** strip above `<header>`:
  - No `data` → omit strip
  - Empty segments → static `Semua stok aman`
  - Else → overflow-hidden track duplicated twice with `.stock-alerts-marquee`; reduced-motion path uses single truncated line (CSS animation none is enough if we also show one row truncated via `motion-reduce:` classes)
- [x] **Step 3: Visual** — critical: `bg-red-950/80 border-red-900/50 text-red-200`; else warning present: amber tint; else gray for empty-safe
- [x] **Step 4: Manual sanity** — page still shows cards + footer; run ticker tests again

---

### Task 4: Spec status

**Files:**
- [x] Modify: `docs/superpowers/specs/2026-07-12-pos-stock-alerts-marquee-design.md` — Status → Approved — implemented
