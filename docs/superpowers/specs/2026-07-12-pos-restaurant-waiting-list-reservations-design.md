# POS Restaurant Waiting List ↔ Reservations — Design

- **Date:** 2026-07-12
- **Status:** Approved for planning
- **Author:** AI + product owner (brainstorming session)
- **Scope:** Wire restaurant **Waiting List** to today’s reservations; seat flow with optional board pick + empty open bill
- **Related:** `2026-07-12-pos-restaurant-mode-design.md`, reservation module, board modes (move / transfer / merge)

---

## 1. Context & Problem

`/dashboard/pos/reservation` already manages reservations (pending → confirmed →
seated, pax, optional table, WhatsApp). Restaurant action rail has **Waiting List**
but only shows “coming soon”. Floor staff need today’s guests on the board without
leaving restaurant mode.

**Decisions (brainstorming):**

| Question | Answer |
|---|---|
| Connection model | **A** — Waiting List shows today’s reservations; seat onto floor |
| Seat table resolution | **B** — Use assigned table if available; else tap denah |
| After seat | **B** — Mark `seated` + create **empty** open bill on that table |
| Approach | Dialog + board `seat` mode; dedicated seat API |

---

## 2. Goals & Non-Goals

### Goals

- Waiting List opens a `DialogPanel` listing today’s `pending` + `confirmed`
  reservations (time ascending).
- **Seat** seats guest: prefer reservation `table_id` when that table is available;
  otherwise enter board **seat mode** and tap an available table.
- On success: reservation → `seated`, table → occupied, empty dine-in open bill
  created, board refresh, select the new bill/table.
- English copy; soft borders; loading + toast; mutual exclusive board modes.

### Non-Goals

- Separate walk-in waiting queue (non-reservation).
- Create/edit reservations inside restaurant.
- WhatsApp from Waiting List.
- Auto-complete reservation when bill is paid (future).
- Changing Reservation page UX beyond shared API reuse.

---

## 3. Interaction flow

### Open Waiting List

1. User taps **Waiting List** on action rail.
2. Dialog loads today’s reservations (`pending` | `confirmed`).
3. Empty state: “No guests waiting today.”
4. Optional footer link: **Manage reservations** → `/dashboard/pos/reservation`.

### Seat (assigned table available)

1. User taps **Seat** on a row with `table_id` whose table status is available.
2. Call seat API with that table (or omit body and use reservation table).
3. Success: toast, close dialog, invalidate tables + open bills + reservations,
   select new order/table.

### Seat (no table / table not available)

1. User taps **Seat**.
2. If no usable table: close dialog, enter **seat mode** with banner  
   `Seat {name} — tap an available table` + Cancel.
3. Tap available table → seat API with `table_id`.
4. Error: toast, stay in seat mode; Cancel exits without API.

**In seat mode:** same pick rules as Move Table (available only); Without Table /
Take Away / cashier handoff disabled; other board modes cleared on enter.

---

## 4. State & components

### `RestaurantPage`

- Extend `boardMode` with `"seat"`.
- `seatingReservation: ReservationRow | null`.
- Wire Waiting List open + seat handlers.

### `RestaurantActionRail`

- Replace coming-soon toast with `onWaitingList` / open dialog callback.

### `WaitingListDialog` (new)

- Props: `open`, `onOpenChange`, `reservations`, `loading`, `seatingId`,
  `onSeat(reservation)`, `tablesById` (for availability / labels).
- DialogPanel `md`; English; soft borders.

### `RestaurantTableBoard`

- Seat mode uses available-only eligibility (`canPickMoveDestination` or
  `canPickSeatDestination` alias).

### Unchanged

- Reservation list page remains source of truth for CRUD / WA.

---

## 5. API

### `GET /api/pos/reservations?date=YYYY-MM-DD`

Existing. Client filters to `pending` | `confirmed` for Waiting List (or pass
status if API already supports multi — otherwise filter client-side).

### `POST /api/pos/reservations/[id]/seat` (new)

**Auth:** POS session.

**Body (optional):** `{ "table_id": "uuid" }`

**Behavior:**

1. Load reservation; must be `pending` or `confirmed`.
2. Resolve `table_id` = body.table_id ?? reservation.table_id; required.
3. Table must exist, active, and have no other active open order (available).
4. Update reservation: `status=seated`, `seated_at=now`, set `table_id` if changed.
5. Create empty open bill:
   - `order_type=dine_in`, `status=pending`, `payment_status=unpaid`
   - `table_id`, `customer_id` if present
   - `items=[]`, totals 0
   - `notes` e.g. `Reservation · {name} · {time_slot}`
6. Mark table `occupied`.
7. Return `{ reservation, order }`.

**Open-bill change:** allow zero items when created via seat (or shared helper used
by seat route). Do not break cashier open-bill that still requires items for normal
order entry.

### Client

- `seatReservation(id, { table_id? })` in reservation or pos-api module.
- Reuse reservation list query keys for invalidation.

---

## 6. Edge cases

| Case | Behavior |
|---|---|
| Assigned table occupied | Toast; enter seat mode to pick another |
| Already seated / cancelled | Not listed |
| Concurrent seat | API conflict / 409; toast |
| Empty bill | Valid open bill with no lines; floor adds items via cashier handoff |
| Cancel seat mode | No reservation change |

---

## 7. Testing & acceptance

**Unit:** destination eligibility for seat mode.

**Manual:**

1. Confirmed reservation with free table → Seat → bill appears, status seated.
2. Confirmed without table → Seat → pick on denah → bill on chosen table.
3. Assigned table busy → forced board pick.
4. Waiting List empty day → empty state.
5. Seat mode Cancel leaves reservation unchanged.
6. Modes exclusive with Move / Transfer / Merge.

---

## 8. File map (indicative)

| File | Change |
|------|--------|
| `waiting-list-dialog.tsx` | New dialog |
| `restaurant-action-rail.tsx` | Open Waiting List |
| `restaurant-page.tsx` | Seat mode + API |
| `restaurant-table-board.tsx` | Seat pick routing |
| `move-destination.ts` | Seat eligibility (or alias) |
| `src/app/api/pos/reservations/[id]/seat/route.ts` | New |
| `src/app/api/pos/orders/open-bill/route.ts` | Allow empty items for seat helper path |
| Reservation api/client | `seatReservation` |

---

## 9. Success criteria

- Floor sees today’s waiting guests from restaurant without opening Reservation page.
- Seat produces occupied table + empty open bill and updates reservation to `seated`.
- Board seat pick matches existing Move Table interaction patterns.
