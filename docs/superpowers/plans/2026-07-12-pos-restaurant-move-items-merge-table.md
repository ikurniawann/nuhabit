# Restaurant Move Items + Merge Table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Move Items and Merge Table to restaurant action rail with hybrid board destination pick, transfer-items API, and PIN-optional merge.

**Architecture:** Pure destination helpers; `RestaurantPage` owns `boardMode` (`move`|`transfer`|`merge`) + busy + transfer payload; item picker dialog then denah tap for transfer; denah tap for merge; new transfer-items route; merge PIN optional when authenticated.

**Tech Stack:** Next.js route handlers, React, TanStack Query, DialogPanel, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-pos-restaurant-move-items-merge-table-design.md`
- English copy; soft borders; DialogPanel; no PIN on restaurant
- Reject unpaid splits on transfer + merge
- Mutual exclusive board modes with existing Move Table

## File map

| File | Responsibility |
|------|----------------|
| `src/features/pos/restaurant/move-destination.ts` | Transfer/merge eligibility helpers |
| `src/features/pos/restaurant/move-destination.test.ts` | Unit tests |
| `src/app/api/pos/orders/[id]/transfer-items/route.ts` | Transfer items API |
| `src/app/api/pos/orders/[id]/merge/route.ts` | Optional PIN; unpaid-split reject |
| `src/lib/pos-api.ts` | `transferOrderItems`, optional PIN `mergeOrders` |
| `src/features/pos/restaurant/components/move-items-dialog.tsx` | Qty picker DialogPanel |
| `src/features/pos/restaurant/components/restaurant-action-rail.tsx` | Actions + guards |
| `src/features/pos/restaurant/components/restaurant-table-board.tsx` | Mode-aware pick |
| `src/features/pos/restaurant/components/restaurant-page.tsx` | Modes, banners, API |

---

### Task 1: Destination helpers + tests

**Files:**
- Modify: `src/features/pos/restaurant/move-destination.ts`
- Modify: `src/features/pos/restaurant/move-destination.test.ts`

- [ ] Add `canPickTransferDestination` — available OR occupied/billing, not source, active
- [ ] Add `canPickMergeDestination` — occupied/billing only, not source, active
- [ ] Tests for both
- [ ] Commit: `feat(pos): add transfer and merge destination helpers`

### Task 2: transfer-items API + merge PIN tweak + client

**Files:**
- Create: `src/app/api/pos/orders/[id]/transfer-items/route.ts`
- Modify: `src/app/api/pos/orders/[id]/merge/route.ts`
- Modify: `src/lib/pos-api.ts`

- [ ] Implement transfer-items (resolve target bill or create open bill; move/split qty; recalc; cancel empty source; reject unpaid splits)
- [ ] Merge: PIN optional; reject unpaid splits; remove cancel-pending-splits side effect when rejecting
- [ ] Client: `transferOrderItems`, `mergeOrders(..., pin?)`
- [ ] Commit: `feat(pos): add transfer-items API and optional merge PIN`

### Task 3: MoveItemsDialog + restaurant UI wiring

**Files:**
- Create: `src/features/pos/restaurant/components/move-items-dialog.tsx`
- Modify: action rail, table board, restaurant page

- [ ] DialogPanel qty picker → Continue with `{ order_item_id, qty }[]`
- [ ] Board mode `move|transfer|merge`; banners; rail actions; unpaid-split guards
- [ ] Run: `npx vitest run src/features/pos/restaurant/`
- [ ] Commit: `feat(pos): wire restaurant Move Items and Merge Table`

---

## Execution

User requested immediate implementation — Tasks 1–3 done.

- [x] Task 1: Destination helpers + tests
- [x] Task 2: transfer-items API + merge PIN tweak + client
- [x] Task 3: MoveItemsDialog + restaurant UI wiring
