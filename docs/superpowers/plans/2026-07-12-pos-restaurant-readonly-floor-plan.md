# Restaurant Read-only Floor Plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Restaurant card grid with stacked read-only 2D denah matching Tables Denah (no drag).

**Architecture:** Extract shared position builder + canvas presentation. Tables keep drag/save; Restaurant uses operate-mode callbacks only.

**Tech Stack:** Next.js, React 19, existing `TableSilhouette`, `floor-layout`, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-pos-restaurant-readonly-floor-plan-design.md`
- Stacked canvases per floor; English copy; soft borders `border-gray-200/70`
- No drag / no PATCH position from Restaurant
- Keep available/occupied/reserved/maintenance behaviors
- Without Table / Take Away unchanged

## File map

| File | Responsibility |
|------|----------------|
| `src/features/pos/tables/floor-layout.ts` | Add `buildFloorNodePositions` |
| `src/features/pos/tables/floor-layout.test.ts` | Cover position builder |
| `src/features/pos/tables/components/floor-plan-canvas.tsx` | Shared canvas UI + optional drag via props |
| `src/features/pos/tables/components/tables-floor-plan.tsx` | Use shared canvas in edit mode |
| `src/features/pos/restaurant/components/restaurant-table-board.tsx` | Operate-mode stacked denah |
| `src/lib/pos-api.ts` | Add `pos_x`/`pos_y` on `PosTable` |

---

### Task 1: Position helper + PosTable fields

**Files:**
- Modify: `src/features/pos/tables/floor-layout.ts`
- Modify: `src/features/pos/tables/floor-layout.test.ts`
- Modify: `src/lib/pos-api.ts`

- [ ] Add `buildFloorNodePositions(tables, cols?)` returning `Record<id, {x,y}>`
- [ ] Add tests for placed vs unplaced
- [ ] Add `pos_x`/`pos_y` optional on `PosTable`
- [ ] Commit: `feat(pos): share floor node position builder`

### Task 2: Shared FloorPlanCanvas + Tables edit wiring

**Files:**
- Create: `src/features/pos/tables/components/floor-plan-canvas.tsx`
- Modify: `src/features/pos/tables/components/tables-floor-plan.tsx`

- [ ] Canvas renders silhouettes at % positions; supports `mode: "edit" | "operate"`
- [ ] edit: existing drag + save + onEdit click
- [ ] operate: click/dblclick/disabled/selected ring; no grab cursor
- [ ] TablesFloorPlan uses edit mode
- [ ] Commit: `refactor(pos): extract shared floor plan canvas`

### Task 3: Restaurant board operate denah

**Files:**
- Modify: `src/features/pos/restaurant/components/restaurant-table-board.tsx`

- [ ] Replace card grid with floor sections + operate canvas
- [ ] Wire handoff / select / disabled behaviors
- [ ] Verify `npx vitest run src/features/pos/tables/floor-layout.test.ts src/features/pos/restaurant/`
- [ ] Commit: `feat(pos): show read-only floor plan on restaurant board`

---

## Execution

User requested immediate implementation — execute Tasks 1–3 in this session.
