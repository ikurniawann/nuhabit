# POS Restaurant Move Items + Merge Table — Design

- **Date:** 2026-07-12
- **Status:** Approved for planning
- **Author:** AI + product owner (brainstorming session)
- **Scope:** Add **Move Items** and **Merge Table** to `/dashboard/pos/restaurant` action rail with board destination pick (hybrid UX); new transfer-items API; merge without supervisor PIN on authenticated POS session
- **Related:** `2026-07-12-pos-restaurant-mode-design.md`, `2026-07-12-pos-restaurant-board-move-design.md`

---

## 1. Context & Problem

Restaurant action rail already supports **Move Table** (whole order → available table via
board pick mode). Floor operators also need:

1. **Move Items** — move *some* line quantities from the selected open bill to another
   table (occupied open bill **or** empty table that gets a new open bill).
2. **Merge Table** — merge the entire selected open bill into another occupied table’s
   open bill.

**Merge** already exists (`MergeTableModal` + `POST /api/pos/orders/[id]/merge`) on Open
Bills / Orders, but requires supervisor PIN and is not wired on restaurant. **Move Items**
does not exist yet (no API / UI).

**Decisions (brainstorming):**

| Question | Answer |
|---|---|
| Move Items meaning | Partial line qty from bill A → bill/table B |
| Destinations | Occupied **or** empty (empty → create open bill) |
| Destination UX | **Hybrid:** Move Items = item dialog then tap denah; Merge = tap denah only |
| Supervisor PIN | **None** for both on restaurant (authenticated POS session); audit via existing auth |
| Approach | Board modes + new `transfer-items` API; relax merge PIN for auth session |

---

## 2. Goals & Non-Goals

### Goals

- Action rail actions **Move Items** and **Merge Table** when an open bill is selected.
- Move Items: `DialogPanel` to pick lines + qty → **transfer mode** → tap table on denah.
- Merge: **merge mode** → tap occupied destination → merge API immediately.
- Empty destination for Move Items creates a new dine-in open bill on that table, then
  transfers selected items.
- Source order with zero remaining items after transfer → `cancelled`.
- Loading + toast success/error; single board mode active at a time (`move` | `transfer` | `merge`).
- English copy; soft borders; `DialogPanel` for item picker.

### Non-Goals

- Drag-and-drop on the floor plan.
- Supervisor PIN on restaurant Move Items / Merge.
- Changing Open Bills / Orders Merge modal UX (may still send PIN).
- Moving items to Without Table / Take Away from this flow.
- Auto KDS reprint / kitchen notification for transferred lines.
- Swapping two occupied tables.

---

## 3. Interaction flows

### Shared prerequisites

- Selection with an open bill (`selectedOrder`), same guard as Move Table / Split Bill.
- Reject entry (toast) if source has **unpaid splits** — restaurant is stricter than the
  legacy Open Bills merge path that cancels pending splits.
- Entering a board mode exits any other board mode (`move` / `transfer` / `merge`
  mutually exclusive).
- Cancel banner, re-toggle action, or change selection away from source → exit mode
  without API call (discard pending transfer selection).

### Move Items

1. User selects bill → **Move Items**.
2. Opens `MoveItemsDialog` (`DialogPanel` `md`):
   - Each line: name, available qty, stepper `0…available`.
   - Footer: Cancel | **Continue** (disabled when total selected qty = 0).
3. Continue → close dialog → enter **transfer mode**.
4. Banner: `Move N items — tap a table` + **Cancel**.
5. Tap destination:
   - **Occupied** (not source) → transfer into that table’s active open bill.
   - **Available / empty** → create open bill on table, then transfer.
6. While request in flight: `busy=true` (disable further picks; Cancel still allowed).
7. Success: toast, exit mode, refresh tables + orders. If source still has items,
   keep source selected; otherwise select the target bill (or clear if unavailable).
8. Error: toast, **stay** in transfer mode for retry.

**In transfer mode, blocked / no-op:** source table; Without Table / Take Away;
double-click cashier handoff; reserved / maintenance / inactive (toast or ignore).

### Merge Table

1. User selects bill → **Merge Table** → enter **merge mode**.
2. Banner: `Merge {order_number} — tap an occupied table` + **Cancel**.
3. Tap occupied destination (not source) → `mergeOrders(sourceId, targetId)` without PIN.
4. Success / error / cancel behavior mirrors Move Table board move (stay on error).

**In merge mode, blocked:** available/empty tables, source, Without Table / Take Away,
handoff — toast or ignore.

---

## 4. State & components

### `RestaurantPage`

Generalize board mode (names indicative):

```ts
type BoardMode = null | "move" | "transfer" | "merge";
// transferPayload?: Array<{ order_item_id: string; qty: number }>
// busy: boolean
```

- Wire `onMoveItems` / `onMergeTable` from action rail.
- Banner strip per mode (reuse Move Table banner pattern).
- Destination handlers call `transferOrderItems` or `mergeOrders` from `@/lib/pos-api`.

### `RestaurantActionRail`

- Add **Move Items** and **Merge Table** actions (English labels, soft outline buttons).
- Guards: require `selectedOrder`; toast if unpaid splits when starting either action.
- Optional: while in matching mode, action could show Cancel — banner Cancel is required.

### `RestaurantTableBoard`

Extend pick routing beyond `moveMode`:

- `boardMode` + `busy` + `onPickDestination(table)`.
- Eligibility helpers (unit-tested), e.g.:
  - `canPickMoveDestination` (existing) — available only.
  - `canPickTransferDestination` — available **or** occupied (not source).
  - `canPickMergeDestination` — occupied only (not source).

### `MoveItemsDialog` (new)

- Props: `open`, `order`, `onClose`, `onContinue(items)`.
- `DialogPanel` + soft borders; loading N/A until Continue (pure selection).

### Unchanged for this scope

- Open Bills / Orders `MergeTableModal` (still can send PIN).
- Move Table board-pick behavior (already shipped).

---

## 5. API

### `POST /api/pos/orders/[id]/transfer-items` (new)

**Auth:** POS session required.

**Body:**

```json
{
  "target_table_id": "uuid",
  "items": [{ "order_item_id": "uuid", "qty": 1 }]
}
```

**Behavior:**

1. Validate source order active; no unpaid splits on source.
2. Resolve destination table:
   - If table has active open bill → target that order; reject if target has unpaid splits.
   - If table available → create dine-in open bill on `target_table_id`, then use as target.
3. For each item: qty must be `1…available`; partial qty decreases/splits line; full qty
   moves row (including customization/modifiers on that line).
4. Recalculate source and target subtotals / tax / discount / totals (same spirit as merge).
5. If source has zero items left → set source `status` to `cancelled`.
6. Return `{ source_order_id, target_order_id, created_target?: boolean }`.

### `POST /api/pos/orders/[id]/merge` (tweak)

- Today: `supervisor_pin` required.
- Change: PIN **optional** when caller has authenticated POS session.
  - If PIN provided → keep existing supervisor validation (Open Bills modal).
  - If PIN omitted → allow merge for authenticated session (restaurant board flow).
- **Always reject** merge when source or target has unpaid splits (both PIN and
  no-PIN paths). Open Bills modal surfaces the API error instead of silently
  cancelling pending splits (intentional hardening vs current cancel-pending side
  effect).

### Client (`pos-api`)

- `transferOrderItems(orderId, { target_table_id, items })`
- `mergeOrders(sourceId, targetId, supervisorPin?)` — PIN optional.

---

## 6. Edge cases

| Case | Behavior |
|---|---|
| Qty > available | Clamp in UI; API rejects |
| All items moved | Source → `cancelled`; source table free |
| Empty destination | Create open bill then transfer |
| Multi-bill on one table | Use active open bill for that table (same as board selection) |
| Partial line with modifiers | Move/split line; keep modifiers on moved portion as existing line model allows |
| Error mid-request | Toast; stay in board mode |
| Completed / cancelled / voided / merged | Cannot be source or target |

---

## 7. Testing & acceptance

**Unit:** destination eligibility helpers; qty clamp / payload builders.

**Manual:**

1. Move partial items occupied → occupied; totals update; both bills remain.
2. Move items to empty table → new bill appears; source reduced/cancelled if empty.
3. Merge occupied → occupied; source `merged`; target has combined items.
4. Unpaid splits block Move Items / Merge with toast.
5. Modes mutually exclusive with Move Table; Cancel exits without API.
6. Loading disables picks; toast on success/error.

---

## 8. File map (indicative)

| File | Change |
|------|--------|
| `restaurant-action-rail.tsx` | Move Items + Merge Table actions |
| `restaurant-page.tsx` | Board modes, banners, API calls |
| `restaurant-table-board.tsx` | Destination pick by mode |
| `move-destination.ts` (or sibling) | Transfer/merge eligibility helpers + tests |
| `MoveItemsDialog.tsx` | New item qty picker |
| `src/app/api/pos/orders/[id]/transfer-items/route.ts` | New |
| `src/app/api/pos/orders/[id]/merge/route.ts` | Optional PIN; unpaid-split reject |
| `src/lib/pos-api.ts` | Client helpers |

---

## 9. Success criteria

- Floor can move partial items to occupied or empty tables without leaving restaurant.
- Floor can merge two open bills via denah tap without PIN.
- Behavior consistent with existing Move Table board mode (banner, busy, toast, cancel).
- No regression to Open Bills merge when PIN is still supplied (unless unpaid-split
  hardening applies — then modal shows clear error).
