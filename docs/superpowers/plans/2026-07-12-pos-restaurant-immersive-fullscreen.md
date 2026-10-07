# Restaurant Immersive Fullscreen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Same-route immersive restaurant board that hides dashboard chrome via `?immersive=1` and preserves the mode through cashier round-trips.

**Architecture:** Pure nav helpers own the URL contract. `AppSidebar` gates chrome when pathname is restaurant + immersive. Restaurant page toggles via `router.replace`. Cashier return / handoff pass `immersive=1` when set.

**Tech Stack:** Next.js App Router, React client components, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-pos-restaurant-immersive-fullscreen-design.md`
- Same route only — no `restaurant-fullscreen` page
- Hide sidebar + top bar (not Browser Fullscreen API)
- Soft borders / outline buttons; English labels Fullscreen / Exit Fullscreen
- No Esc-to-exit; no new IAM

## File map

| File | Responsibility |
|------|----------------|
| `src/features/pos/restaurant/nav.ts` | Immersive param helpers + handoff/return URLs |
| `src/features/pos/restaurant/nav.test.ts` | Unit coverage for helpers |
| `src/components/shared/app-sidebar.tsx` | Hide chrome when restaurant immersive |
| `src/features/pos/restaurant/components/restaurant-page.tsx` | Toggle strip + immersive height |
| `src/features/pos/restaurant/components/restaurant-table-board.tsx` | Pass immersive on handoff |
| `src/features/pos/restaurant/components/restaurant-bills-rail.tsx` | Pass immersive on handoff |
| `src/features/pos/cashier/components/cashier-page.tsx` | Return to restaurant with immersive preserved |

---

### Task 1: Nav helpers + tests

**Files:**
- Modify: `src/features/pos/restaurant/nav.ts`
- Modify: `src/features/pos/restaurant/nav.test.ts`

**Produces:**
- `RESTAURANT_IMMERSIVE_PARAM = "immersive"`
- `isRestaurantImmersive(searchParams): boolean`
- `restaurantPath({ immersive?: boolean }): string`
- `buildCashierHandoffUrl({ …, immersive?: boolean })` sets `immersive=1` when true

- [ ] Extend tests for immersive helpers + handoff flag
- [ ] Implement helpers
- [ ] Run: `npx vitest run src/features/pos/restaurant/nav.test.ts`
- [ ] Commit: `feat(pos): add restaurant immersive URL helpers`

### Task 2: AppSidebar immersive gate

**Files:**
- Modify: `src/components/shared/app-sidebar.tsx`

- [ ] `useSearchParams` + gate when `pathname === RESTAURANT_PATH && isRestaurantImmersive`
- [ ] Immersive render: no aside / mobile header / desktop top bar; full-bleed `main`
- [ ] Commit: `feat(pos): hide dashboard chrome for restaurant immersive`

### Task 3: Restaurant page toggle + handoff wiring

**Files:**
- Modify: `src/features/pos/restaurant/components/restaurant-page.tsx`
- Modify: `src/features/pos/restaurant/components/restaurant-table-board.tsx`
- Modify: `src/features/pos/restaurant/components/restaurant-bills-rail.tsx`

- [ ] Top strip with Fullscreen / Exit Fullscreen (`router.replace`)
- [ ] Immersive grid height ≈ `100dvh` minus strip
- [ ] Handoff call sites pass `immersive: isRestaurantImmersive(searchParams)`
- [ ] Commit: `feat(pos): add restaurant immersive toggle and handoff flag`

### Task 4: Cashier return preserves immersive

**Files:**
- Modify: `src/features/pos/cashier/components/cashier-page.tsx`

- [ ] Read `immersive` from cashier searchParams
- [ ] `maybeReturnToRestaurant` / deferred return / Back to Restaurant use `restaurantPath({ immersive })`
- [ ] Run: `npx vitest run src/features/pos/restaurant/nav.test.ts`
- [ ] Commit: `feat(pos): preserve restaurant immersive on cashier return`

---

## Execution

User requested immediate implementation — Tasks 1–4 executed in this session.

- [x] Task 1: Nav helpers + tests
- [x] Task 2: AppSidebar immersive gate (+ Suspense)
- [x] Task 3: Restaurant toggle + handoff wiring (+ Suspense)
- [x] Task 4: Cashier return preserves immersive
