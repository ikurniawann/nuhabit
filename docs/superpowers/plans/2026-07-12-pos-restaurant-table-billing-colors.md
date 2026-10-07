# Restaurant Table Billing Colors — Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox syntax.

**Goal:** Denah colors: green available, orange occupied, red pre-settled until paid; add-order clears pre-settle back to orange.

**Architecture:** `pre_settled_at` on `pos.pos_orders`; tables API derives `billing`; Pre Settlement sets flag; open-bill clears for table.

**Tech Stack:** PostgreSQL delta migration, Next.js API routes, Vitest for status helper.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-pos-restaurant-table-billing-colors-design.md`
- Soft borders / English UI retained
- Do not stage unrelated WIP

## File map

| File | Responsibility |
|------|----------------|
| `database/migrations/deltas/20260712160000_pos_orders_pre_settled_at.sql` | Column |
| `src/features/pos/restaurant/table-board-status.ts` | Pure status resolver |
| `src/features/pos/restaurant/table-board-status.test.ts` | Tests |
| `src/app/api/pos/tables/route.ts` | Expose flag + derive status |
| `src/app/api/pos/orders/[id]/pre-settle/route.ts` | Set flag |
| `src/app/api/pos/orders/open-bill/route.ts` | Clear flag for table |
| `src/lib/pos-api.ts` | Types + client helper |
| `src/features/pos/tables/components/floor-plan-canvas.tsx` | Red tone |
| `src/features/pos/restaurant/components/restaurant-action-rail.tsx` | Call pre-settle |
| `src/features/pos/restaurant/components/restaurant-table-board.tsx` | Pass derived status |

---

### Task 1: Migration + status helper

- [ ] Add `pre_settled_at` column
- [ ] `resolveTableBoardStatus({ tableStatus, activeOrder })`
- [ ] Vitest
- [ ] Run migration if tooling available

### Task 2: API + types

- [ ] Tables GET includes `pre_settled_at`, status `billing` when set
- [ ] Pre-settle route
- [ ] open-bill clears `pre_settled_at` for table’s active orders
- [ ] PosTable type fields

### Task 3: UI

- [ ] `statusNodeTone('billing')` → red
- [ ] Pre Settlement wires API then handoff
- [ ] Board uses API status (or resolver client-side)
