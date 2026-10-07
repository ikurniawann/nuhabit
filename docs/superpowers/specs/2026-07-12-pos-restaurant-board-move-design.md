# POS Restaurant Board Move (No Modal) — Design

- **Date:** 2026-07-12
- **Status:** Approved for planning
- **Author:** AI + product owner (brainstorming session)
- **Scope:** Replace restaurant Move Table modal with on-board destination pick mode (direct API move)
- **Related:** `2026-07-12-pos-restaurant-mode-design.md`

---

## 1. Context & Problem

On `/dashboard/pos/restaurant`, **Move Table** opens `MoveTableModal`: pick order type +
destination table + confirm. Floor operators already see the denah; the modal is an
extra step. They want: after Move Table, tap the destination table on the board and
move immediately.

**Decisions (brainstorming):**

| Question | Answer |
|---|---|
| Interaction | **Pick mode on board** after Move Table (not drag-drop, not two-click without mode) |
| Confirm | **None** — tap available destination → call API immediately |
| Implementation | Restaurant-page state + board wiring; drop modal usage on restaurant only |
| Order type change | **Out of scope** (modal remains on open-bills / orders pages) |

---

## 2. Goals & Non-Goals

### Goals

- Enter a clear **move mode** from Move Table when an open bill is selected.
- Tap an **available** table on the denah to move the order via existing `moveOrderTable`.
- Show loading + toast success/error; exit move mode on success.
- Cancel move mode without moving.
- Remove `MoveTableModal` from the restaurant page only.

### Non-Goals

- Drag-and-drop moves.
- Swapping two occupied tables.
- Changing order type (takeaway / delivery / etc.) from restaurant move flow.
- Changing Move Table UX on Open Bills or Orders pages.
- Confirm / undo toast after move.

---

## 3. Interaction flow

**Prerequisite:** selection with an open bill (`selectedOrder`), same guard as today on
the action rail.

1. User clicks **Move Table**.
2. Restaurant enters **move mode**:
   - Banner: `Move {order_number} — tap an available table` + **Cancel**.
   - Source table stays selected/highlighted.
3. User taps an **available** table → `moveOrderTable(orderId, destinationTableId)`.
4. While request in flight: `moving=true` (disable further picks / Cancel stays allowed).
5. Success: toast, exit move mode, clear or refresh selection, refetch tables + orders.
6. Error: toast, **stay** in move mode so another table can be tried.
7. Exit move mode without API call: **Cancel**, toggle Move Table again, or change
   selection away from the source bill.

**In move mode, blocked / no-op:**

- Occupied (non-source), reserved, maintenance, inactive tables → short toast or ignore.
- Without Table / Take Away buttons → disabled.
- Double-click open-cashier → disabled.
- Clicking the source table → no-op (already source).

---

## 4. State & components

### `RestaurantPage`

- `moveMode: boolean`
- `moving: boolean` (API in flight)
- Source order = existing `selectedOrder` (must be non-null to enter mode)
- `onMoveTable` → `setMoveMode(true)` (rail already errors if no order)
- Banner strip above the 3-column grid when `moveMode`
- On destination pick → call `moveOrderTable` from `@/lib/pos-api`
- Remove `MoveTableModal` import/usage from this page

### `RestaurantTableBoard`

New props (names indicative):

- `moveMode?: boolean`
- `moving?: boolean`
- `onPickDestination?: (table: PosTable) => void`

When `moveMode`:

- Available → `onPickDestination`
- Occupied select / double-click handoff suppressed
- Without Table / Take Away disabled

Optional pure helper (unit-tested):

```ts
canPickMoveDestination(table, { sourceTableId }): boolean
// true only when available (and not source)
```

### `RestaurantActionRail`

- Unchanged entry: still calls `onMoveTable` when `selectedOrder` exists
- Optional: while `moveMode`, Move Table label could read **Cancel Move** if page
  passes a cancel handler — or rely on banner Cancel only (banner Cancel is required)

### Unchanged

- `MoveTableModal` for open-bills / orders
- `moveOrderTable` API contract

---

## 5. Visual

- Move-mode banner: soft border (`border-gray-200/70` / `border-primary/20`), English copy
- Available destinations: clear pointer affordance (existing available tone + optional soft ring)
- Non-targets: muted / disabled via existing `isDisabled` on operate canvas
- Buttons show loading/disabled while `moving` (UI standards)

---

## 6. Testing

### Unit

- `canPickMoveDestination` (or equivalent) for available / occupied / source / reserved

### Manual

- Select bill → Move Table → tap available → success, board updates, mode exits
- Cancel leaves order on original table
- Tap occupied destination → no move
- API error → toast, still in move mode
- Immersive mode still works with move banner

---

## 7. Success criteria

- Restaurant table→table move no longer requires a modal.
- Operators can complete a move in two gestures: Move Table → tap destination.
- Open Bills / Orders keep the existing modal flow.
