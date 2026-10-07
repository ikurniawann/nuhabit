# Restaurant Board Move (No Modal) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement task-by-task.

**Goal:** Move Table on restaurant board uses pick-mode on the denah (tap available destination) instead of `MoveTableModal`.

**Architecture:** Pure `canPickMoveDestination` helper; `RestaurantPage` owns `moveMode`/`moving` + API call; `RestaurantTableBoard` routes clicks in move mode; remove modal from restaurant page only.

**Tech Stack:** React, TanStack Query invalidate, existing `moveOrderTable`, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-pos-restaurant-board-move-design.md`
- Direct move (no confirm); English copy; soft borders
- Keep `MoveTableModal` on open-bills / orders

## File map

| File | Responsibility |
|------|----------------|
| `src/features/pos/restaurant/move-destination.ts` | `canPickMoveDestination` |
| `src/features/pos/restaurant/move-destination.test.ts` | Unit tests |
| `src/features/pos/restaurant/components/restaurant-table-board.tsx` | Move-mode click routing |
| `src/features/pos/restaurant/components/restaurant-page.tsx` | State, banner, API, drop modal |

---

### Task 1: Helper + tests

- [ ] Add `canPickMoveDestination(table, { sourceTableId })`
- [ ] Tests: available ok; source false; occupied/reserved/maintenance/inactive false
- [ ] Commit: `feat(pos): add restaurant move destination helper`

### Task 2: Board + page wiring

- [ ] Board props `moveMode`, `moving`, `sourceTableId`, `onPickDestination`
- [ ] Page: moveMode banner, moveOrderTable, invalidate/refetch, remove MoveTableModal
- [ ] Run: `npx vitest run src/features/pos/restaurant/`
- [ ] Commit: `feat(pos): move restaurant tables via board pick mode`

---

## Execution

User requested immediate implementation — Tasks 1–2 done.

- [x] Task 1: Helper + tests
- [x] Task 2: Board + page wiring
