# POS Restaurant Mode (Table Board) — Design

- **Date:** 2026-07-12
- **Status:** Draft for approval
- **Author:** AI + product owner (brainstorming session)
- **Scope:** New restaurant table-board page + return-to-restaurant flow from cashier

---

## 1. Context & Problem

Cashiers currently use `/dashboard/pos/cashier-new` (product grid + cart). Table
selection is a modal. Restaurant operations need a dedicated **table board**
surface (similar to classic restaurant POS): glanceable table status by floor,
quick actions, and active open bills — then hand off into the existing cashier
for ordering/payment.

**Decisions (brainstorming):**

| Question | Answer |
|---|---|
| Depth | Near-full (layout + wired core actions; some stubs) |
| Placement | **New page** `/dashboard/pos/restaurant` |
| Transaction flow | Restaurant → regular cashier → after pay / save open bill → **back to restaurant** when `from=restaurant` |
| UI language | English |
| Visual | Reference image is inspiration only; use Arkiv soft borders / primary tokens (not flat orange/blue blocks) |

Existing building blocks to reuse:
- Tables API + floor grouping (`floor`, `pos_x`/`pos_y`, status)
- Open bills feature + `MoveTableModal` / `SplitBillModal`
- Cashier page (already loads open bill via query params)

---

## 2. Goals & Non-Goals

### Goals

- Deliver a restaurant **table board** page with 3-column layout: action rail,
  center board (Without Table / Take Away + tables by floor), right open-bills rail.
- Start dine-in / takeaway / without-table transactions in existing cashier with
  return context.
- After successful **payment** or **save open bill**, return to restaurant mode
  when the session originated from restaurant.
- Wire core sidebar actions to existing modals/pages; stub domains that do not
  exist yet (Waiting List, Message) with clear toast.
- Add IAM menu under POS Operasional.

### Non-Goals

- Replacing cashier product UI with restaurant chrome.
- Full Waiting List / Message / Pre-Settlement domain models in v1.
- Exact pixel clone of the reference POS (colors/layout are directional only).
- Real-time multi-device sync beyond existing query invalidation/refetch.
- Floor-plan drag editor inside restaurant mode (master remains `/dashboard/pos/tables`).

---

## 3. Information architecture

### Route & menu

- Page: `/dashboard/pos/restaurant`
- Feature: `src/features/pos/restaurant/`
- IAM: `pos.operations.restaurant`, label **Restaurant**, icon e.g. `building` /
  `map`, sidebar under Operasional (near Cashier / Tables / Open Bills)
- Fullscreen optional later; v1 uses dashboard shell like other POS pages

### Cashier handoff query contract

When navigating to cashier from restaurant:

```
/dashboard/pos/cashier-new?from=restaurant&tableId=<uuid>
/dashboard/pos/cashier-new?from=restaurant&orderType=takeaway
/dashboard/pos/cashier-new?from=restaurant&orderType=dine_in   // without table
/dashboard/pos/cashier-new?from=restaurant&orderId=<uuid>      // resume open bill
```

Rules:

- `from=restaurant` is the return flag (required for bounce-back).
- `tableId` → set dine-in + select table on mount (if available).
- `orderId` / existing payment-order params → load open bill as cashier already does.
- `orderType=takeaway|dine_in` when no table.

Return targets:

- Success payment → `/dashboard/pos/restaurant`
- Save open bill success → `/dashboard/pos/restaurant`
- Manual “Back” control on cashier when `from=restaurant` → restaurant (confirm if cart dirty)

If `from` is absent, cashier behavior unchanged (no forced return).

---

## 4. UX layout

### 4.1 Left action rail

Vertical buttons (compact, soft borders, primary/secondary tones — not neon
blocks). English labels:

| Action | v1 behavior |
|---|---|
| Waiting List | Toast: not available yet |
| Order Check | Requires selected bill → open Order Check preview modal (view only, no Print) |
| Pre Settlement | Requires selected bill → mark `pre_settled_at`, board `billing`, Preview Bill modal with Print (stay on restaurant) |
| Split Bill | Requires selected bill → open existing `SplitBillModal` |
| Transfer / Move Table | Requires selected bill → open existing `MoveTableModal` |
| Reprint | If last receipt payload in session/storage exists, reprint; else toast |
| Message | Toast stub |
| View Orders | Open modal listing all open bills with waiting time from order clock |
| Time | Live clock display (not a navigation action) |

Selection model: clicking an open-bill card (right) or occupied table (center)
sets **active selection** used by rail actions.

### 4.2 Center board

Top row chips/cards:

- **Without Table** → cashier dine-in, no table, `from=restaurant`
- **Take Away** → cashier takeaway, `from=restaurant`

Below: sections **per floor** (Basement, Ground Floor, Floor 1…, Unassigned),
same ordering helpers as Tables floor plan (`floor-options.ts`).

Each table tile:

- Label: table number / name
- Meta: capacity, area (optional short)
- Status color: available / occupied / reserved / maintenance
- Occupied shows order number snippet when present
- Click available → start new dine-in on that table
- Click occupied → select + optionally open that bill (Order Check / double-click or primary click opens bill — **v1: single click selects; “Open” via Order Check or second click on already-selected occupied table opens cashier**)

To keep interaction simple for v1:

- **Available:** click → go to cashier with `tableId`
- **Occupied:** click → set selection; **double-click or Enter** → open bill in cashier
- Selected tile: primary ring/border

### 4.3 Right open-bills rail

- List open bills (reuse open-bills API/query), newest first
- Show order number, table label, amount, time
- Click → set selection
- Double-click / Open button → cashier with `orderId&from=restaurant`
- Empty state copy in English

### 4.4 Header

- Title: **Restaurant**
- Subtitle: counts e.g. `12 available · 5 occupied`
- Optional refresh button (invalidate tables + open bills queries)
- Link/button to Cashier (product mode) without return flag

---

## 5. Data & APIs

No new tables required for v1.

**Reads:**

- `GET /api/pos/tables` (active tables; includes `floor`, status, `active_order`)
- Existing open-bills list API used by Open Bills page

**Writes:** unchanged — cashier / split / move endpoints remain source of truth.

**Client modules (proposed):**

```
src/features/pos/restaurant/
  components/
    restaurant-page.tsx
    restaurant-action-rail.tsx
    restaurant-table-board.tsx
    restaurant-bills-rail.tsx
  hooks/ (optional thin wrappers)
  index.ts
src/app/dashboard/pos/restaurant/page.tsx
```

Cashier changes (minimal):

- Read `from`, `tableId`, `orderType` from searchParams on mount
- After pay / open-bill success, if `from=restaurant` → `router.push('/dashboard/pos/restaurant')`
- Show Back to Restaurant when `from=restaurant`

---

## 6. Permissions

- Menu + page gated like other POS ops pages (`pos.operations.restaurant`)
- Actions inherit existing POS session auth on reused APIs
- Seed role permissions for roles that already have cashier/open-bills access
  (admin + pos roles per existing IAM patterns)

---

## 7. Acceptance criteria

1. Menu **Restaurant** opens `/dashboard/pos/restaurant` with 3-column board.
2. Tables grouped by floor; statuses visually distinct.
3. Without Table / Take Away enter cashier with correct order type + return flag.
4. Available table click enters cashier with table selected + return flag.
5. Occupied table can be selected; open bill path reaches cashier with order loaded.
6. Payment success from this path returns to restaurant.
7. Save open bill from this path returns to restaurant.
8. Split Bill / Move Table work when a bill is selected (reuse modals).
9. Waiting List / Message show non-blocking “coming soon” toast.
10. Cashier without `from=restaurant` does not auto-return to restaurant.
11. English UI copy on restaurant page and related toasts.

---

## 8. Phasing inside this feature

Still one deliverable, but implement in order:

1. Page shell + table board by floor + IAM menu  
2. Handoff to cashier + return after pay/open bill  
3. Right bills rail + selection model  
4. Wire Split / Move / Order Check / Pre Settlement / View Orders / Reprint / Time  
5. Stubs Waiting List / Message  

---

## 9. Open risks

- Cashier has many success paths (split payment, offline queue) — return logic must
  cover the main online pay + open-bill save paths; document any residual paths
  as follow-up.
- Occupied status currently derived from active orders in tables API — trust that
  source; do not invent a second status channel.
- Large table counts: floor sections + scroll; keep tiles compact.

---

## 10. Resolved decisions

| Item | Decision |
|---|---|
| Approach | A — new page + return query context |
| Route | `/dashboard/pos/restaurant` |
| Return triggers | Pay success + save open bill |
| Sidebar stubs | Waiting List, Message |
| Visual | Arkiv design system, reference = structure only |
