# POS Restaurant Mode — Read-only Floor Plan Board

- **Date:** 2026-07-12
- **Status:** Approved — implemented
- **Author:** AI + product owner (brainstorming session)
- **Parent:** `docs/superpowers/specs/2026-07-12-pos-restaurant-mode-design.md`
- **Scope:** Replace Restaurant table card grid with 2D denah (stacked per floor), no drag

---

## 1. Context & Problem

Restaurant Mode (`/dashboard/pos/restaurant`) currently shows tables as a **card grid** grouped by floor. Tables admin already has a **2D floor plan** (`TablesFloorPlan`) using silhouettes + `pos_x`/`pos_y`.

Cashiers need the same spatial denah on the restaurant board so table layout matches the room, without being able to rearrange furniture (that stays on Tables CRUD).

**Decisions (brainstorming):**
- Multi-floor: **stacked canvases** per floor (Basement → GF → Floor 1…)
- Approach: **shared canvas** with interactive vs read-only mode (extract from Tables floor plan)
- Drag / position save: **disabled** on Restaurant

---

## 2. Goals

- Restaurant center column looks like Tables → Denah: silhouette nodes on a canvas, positions from `pos_x`/`pos_y`.
- Unplaced tables still get a local grid fallback (`assignGridPositions`) — same as Denah.
- No pointer-drag, no `PATCH .../position` from Restaurant.
- Keep existing Restaurant interactions and chrome:
  - Without Table / Take Away buttons
  - available → open cashier handoff
  - occupied → select; double-click → open order
  - reserved / maintenance → non-actionable / not focusable
  - Action rail + Open Bills rail unchanged

## 3. Non-goals

- Editing table positions from Restaurant
- Floor tabs / single merged canvas
- Redesigning silhouette art
- Changing IAM / routes
- Translating Move/Split modals

---

## 4. UX

### Layout (center column)

1. Row: **Without Table** | **Take Away** (unchanged)
2. For each floor group (sorted via `floorSortKey` / `floorLabel`):
   - Section card: soft border, header with floor label + table count
   - Canvas: relative box, soft `border-gray-200/70`, light gray ground — same visual language as `TablesFloorPlan`
   - Nodes: absolute `%` left/top, ~96×96, `TableSilhouette` with table number label
   - Status tone via text/node color (available / occupied / reserved / maintenance) — align with existing Denah tones + Restaurant selection ring when occupied table is selected

### Interaction

| Status | Click | Double-click | Keyboard |
|--------|-------|--------------|----------|
| available | Handoff to cashier (`tableId`) | — | Activate = same as click |
| occupied | Select for action rail | Open order handoff if `active_order` | Enter/Space = select |
| reserved / maintenance | No-op; control disabled | — | Not focusable |

Cursor: `pointer` (or default) — **never** `grab` / `grabbing` on Restaurant.

### Empty / loading / error

Reuse current Restaurant board messaging (loading spinner, error banner, empty state).

---

## 5. Architecture

### Shared piece

Extract or generalize floor canvas from `src/features/pos/tables/components/tables-floor-plan.tsx`:

- **Tables (interactive):** drag + auto-save position + click opens edit (current behavior)
- **Restaurant (read-only):** no drag handlers; callbacks for click / double-click / disabled statuses

Preferred API shape (illustrative):

```ts
type FloorCanvasMode = "edit" | "operate";

// edit → Tables CRUD denah
// operate → Restaurant board (read-only positions)
```

Keep helpers in `floor-layout.ts` (`clampPercent`, `isPlaced`, `assignGridPositions`) and `TableSilhouette` shared.

### Restaurant board

`restaurant-table-board.tsx` replaces card grid with stacked floor sections + operate-mode canvas. Props/callbacks stay conceptually the same (`onSelectOccupied`, `onOpenAvailable`, `selectedTableId`).

### Data

- Extend `PosTable` in `src/lib/pos-api.ts` with `pos_x?: number | null` and `pos_y?: number | null` (list API already returns them).
- Confirm cashier tables query does not strip coordinates.

### Files (expected touch list)

| File | Change |
|------|--------|
| `tables-floor-plan.tsx` (and/or new shared canvas) | Split interactive vs read-only |
| `restaurant-table-board.tsx` | Render denah stack |
| `src/lib/pos-api.ts` | Add `pos_x` / `pos_y` on `PosTable` |
| Tests (optional small) | Position resolve / grouping unchanged; no drag in operate mode |

---

## 6. Acceptance

- [ ] Restaurant board shows silhouette denah per floor, not card tiles
- [ ] Positions match Tables Denah for placed tables; unplaced use grid fallback
- [ ] Dragging a table on Restaurant does nothing (no move, no save toast)
- [ ] Tables Denah still supports drag + save
- [ ] Available / occupied / reserved / maintenance behaviors unchanged
- [ ] Without Table / Take Away still work
- [ ] Soft borders only; English UI copy retained

---

## 7. Open notes

- Selection ring for occupied tables must remain visible on silhouette nodes (not only old card styles).
- If canvas height math differs slightly from Tables, prefer matching Tables formula for visual parity.
