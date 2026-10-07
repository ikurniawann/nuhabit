# POS Restaurant Mode (Table Board) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/dashboard/pos/restaurant` — a 3-column restaurant table board that hands off to cashier with `from=restaurant` and returns after pay / save open bill.

**Architecture:** New feature module `src/features/pos/restaurant` for the board UI. Cashier reads return-context query params and redirects home to restaurant on success. Reuse tables + open-bills queries and existing Split/Move modals. No new DB tables.

**Tech Stack:** Next.js App Router, React 19, TanStack Query, existing POS APIs (`/api/pos/tables`, open bills via `getOrders`), IAM menu seeders, Vitest for pure helpers.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-pos-restaurant-mode-design.md`
- Route: `/dashboard/pos/restaurant`
- Return query flag: `from=restaurant` (exact string)
- Cashier handoff base: `/dashboard/pos/cashier-new` (`CASHIER_ROUTES.embedded`)
- After **payment success** or **save open bill success**, if `from=restaurant` → `router.push('/dashboard/pos/restaurant')`
- Without `from=restaurant`, cashier behavior unchanged
- UI copy: English
- Soft borders (`border-gray-200/70`); Arkiv tokens; reference image = structure only
- Waiting List + Message = toast stub only in v1
- Reuse `floorLabel` / `floorSortKey` from `src/features/pos/tables/floor-options.ts`
- Every mutation/action that hits API: loading + toast (no duplicate toasts)
- Do not stage unrelated WIP when committing

## File map

| File | Responsibility |
|---|---|
| `src/features/pos/restaurant/nav.ts` | Build cashier URLs with return context |
| `src/features/pos/restaurant/nav.test.ts` | Unit tests for URL builders |
| `src/features/pos/restaurant/selection.ts` | Selection types + helpers |
| `src/features/pos/restaurant/components/restaurant-page.tsx` | Shell: header + 3 columns + selection state |
| `src/features/pos/restaurant/components/restaurant-action-rail.tsx` | Left actions |
| `src/features/pos/restaurant/components/restaurant-table-board.tsx` | Without Table / Take Away + floor groups |
| `src/features/pos/restaurant/components/restaurant-bills-rail.tsx` | Right open bills |
| `src/features/pos/restaurant/index.ts` | Public export |
| `src/app/dashboard/pos/restaurant/page.tsx` | Route entry |
| `src/features/pos/cashier/constants.ts` | Optional `RESTAURANT_ROUTE` constant |
| `src/features/pos/cashier/components/cashier-page.tsx` | Apply handoff params + return redirects + Back button |
| `database/seeders/iam-menus.sql` | Menu + prune allowlist |
| `database/seeders/iam-role-permissions.sql` | Grant restaurant read to roles that have cashier |

---

### Task 1: Nav helpers + IAM menu + empty page shell

**Files:**
- Create: `src/features/pos/restaurant/nav.ts`
- Create: `src/features/pos/restaurant/nav.test.ts`
- Create: `src/features/pos/restaurant/index.ts`
- Create: `src/features/pos/restaurant/components/restaurant-page.tsx` (minimal shell)
- Create: `src/app/dashboard/pos/restaurant/page.tsx`
- Modify: `database/seeders/iam-menus.sql`
- Modify: `database/seeders/iam-role-permissions.sql` (if roles use explicit codes)
- Modify: `src/features/pos/cashier/constants.ts` — add `RESTAURANT_ROUTE = "/dashboard/pos/restaurant"`

**Interfaces:**
- Consumes: `CASHIER_ROUTES.embedded`
- Produces:
  - `RESTAURANT_FROM = "restaurant"`
  - `buildCashierHandoffUrl(opts: { tableId?: string; orderId?: string; orderType?: "dine_in" | "takeaway"; pay?: boolean }): string`
  - Page renders title **Restaurant**

- [ ] **Step 1: Write failing nav tests**

```ts
import { describe, expect, it } from "vitest";
import { RESTAURANT_FROM, buildCashierHandoffUrl } from "./nav";

describe("buildCashierHandoffUrl", () => {
  it("always sets from=restaurant", () => {
    const url = buildCashierHandoffUrl({});
    expect(url).toContain("from=restaurant");
    expect(RESTAURANT_FROM).toBe("restaurant");
  });

  it("includes tableId", () => {
    expect(buildCashierHandoffUrl({ tableId: "abc" })).toContain("tableId=abc");
  });

  it("includes orderType takeaway", () => {
    expect(buildCashierHandoffUrl({ orderType: "takeaway" })).toContain(
      "orderType=takeaway"
    );
  });

  it("includes orderId", () => {
    expect(buildCashierHandoffUrl({ orderId: "ord-1" })).toContain(
      "orderId=ord-1"
    );
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/features/pos/restaurant/nav.test.ts
```

- [ ] **Step 3: Implement nav + shell + IAM**

`nav.ts`:

```ts
import { CASHIER_ROUTES } from "@/features/pos/cashier/constants";

export const RESTAURANT_FROM = "restaurant";
export const RESTAURANT_PATH = "/dashboard/pos/restaurant";

export function buildCashierHandoffUrl(opts: {
  tableId?: string;
  orderId?: string;
  orderType?: "dine_in" | "takeaway";
  pay?: boolean;
}): string {
  const params = new URLSearchParams();
  params.set("from", RESTAURANT_FROM);
  if (opts.tableId) params.set("tableId", opts.tableId);
  if (opts.orderId) params.set("orderId", opts.orderId);
  if (opts.orderType) params.set("orderType", opts.orderType);
  if (opts.pay) params.set("pay", "1");
  return `${CASHIER_ROUTES.embedded}?${params.toString()}`;
}
```

IAM menu row (near other operations, sort ~15):

```sql
('pos.operations.restaurant', 'Restaurant', '/dashboard/pos/restaurant', 'map', 'sidebar', 15, '{"actions":["read"]}'::jsonb),
```

Add `'pos.operations.restaurant'` to prune `NOT IN` allowlist.

Page shell: header + placeholder 3 columns (“Board coming in next task”).

- [ ] **Step 4: Seed + tests**

```bash
npm run db:seed:iam-menus
npm run db:seed:iam-roles   # if needed for grants
npx vitest run src/features/pos/restaurant/nav.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/features/pos/restaurant src/app/dashboard/pos/restaurant \
  src/features/pos/cashier/constants.ts database/seeders/iam-menus.sql \
  database/seeders/iam-role-permissions.sql
git commit -m "$(cat <<'EOF'
feat(pos): add restaurant route shell, nav helpers, and IAM menu

EOF
)"
```

---

### Task 2: Table board (center) grouped by floor

**Files:**
- Create: `src/features/pos/restaurant/components/restaurant-table-board.tsx`
- Modify: `restaurant-page.tsx` — wire tables query + board

**Interfaces:**
- Consumes: `useCashierTables` or `usePosTables(false)` (active only), `floorLabel`, `floorSortKey`, `buildCashierHandoffUrl`, `PosTable`
- Produces: `<RestaurantTableBoard tables onSelectOccupied onOpenAvailable />`

- [ ] **Step 1: Implement board**

Behavior (exact):

- Top: two buttons **Without Table** → `buildCashierHandoffUrl({ orderType: "dine_in" })`; **Take Away** → `orderType: "takeaway"`
- Group tables by `floor` (same pattern as cashier modal / floor plan)
- Tile status classes:
  - available → white / soft border
  - occupied → emerald tint
  - reserved → blue tint
  - maintenance → slate / disabled
- Available click → `router.push(buildCashierHandoffUrl({ tableId }))`
- Occupied click → call `onSelectOccupied(table)`
- Occupied double-click → `router.push(buildCashierHandoffUrl({ orderId: table.active_order.id, tableId }))` when `active_order` exists; else toast error
- Show capacity + short area on tile

Use soft borders; English copy; loading/error/empty states.

- [ ] **Step 2: Wire into page with `useCashierTables()`**

Header subtitle: `{available} available · {occupied} occupied`

- [ ] **Step 3: Manual smoke** — open `/dashboard/pos/restaurant`, confirm floor sections render.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pos): add restaurant table board grouped by floor

EOF
)"
```

---

### Task 3: Cashier handoff apply + return after pay / open bill

**Files:**
- Modify: `src/features/pos/cashier/components/cashier-page.tsx`
- Optionally small helper: `src/features/pos/restaurant/return-context.ts` imported by cashier (or inline)

**Interfaces:**
- Consumes: `searchParams.get("from"|"tableId"|"orderType"|"pay")`
- Produces: apply table/orderType on mount; redirect to `RESTAURANT_PATH` on success when from restaurant

- [ ] **Step 1: On mount effects**

After existing `orderId` load effect, add:

```ts
const fromRestaurant = searchParams.get("from") === "restaurant";
const handoffTableId = searchParams.get("tableId");
const handoffOrderType = searchParams.get("orderType");

useEffect(() => {
  if (!fromRestaurant) return;
  if (handoffOrderType === "takeaway" || handoffOrderType === "dine_in") {
    cart.setOrderType(handoffOrderType);
  }
  if (handoffTableId) {
    cart.setOrderType("dine_in");
    cart.setTable(handoffTableId);
  }
}, [fromRestaurant, handoffTableId, handoffOrderType]); // cart setters stable / intentional once
```

Guard with a ref so it does not fight user changes every render (`handoffAppliedRef`).

- [ ] **Step 2: Return helper**

```ts
function maybeReturnToRestaurant() {
  if (searchParams.get("from") === "restaurant") {
    router.push("/dashboard/pos/restaurant");
  }
}
```

Call after successful paths that today `cart.clearCart()` following pay / open bill:

1. `handleOpenBill` success (after toast + clearCart)
2. Main online payment success block(s) that clear cart after paid
3. Offline/local pay success that clears cart (if present)

Do **not** redirect on failed pay.

- [ ] **Step 3: Back button**

When `fromRestaurant`, show outline button **Back to Restaurant** near header actions → `router.push("/dashboard/pos/restaurant")`. If `cart.items.length > 0`, `window.confirm("Leave cashier and discard cart?")` before navigate.

- [ ] **Step 4: Smoke**

From restaurant click available table → cashier has table selected → save open bill → lands on restaurant.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pos): return to restaurant mode after cashier pay or open bill

EOF
)"
```

---

### Task 4: Bills rail + selection model

**Files:**
- Create: `src/features/pos/restaurant/components/restaurant-bills-rail.tsx`
- Create: `src/features/pos/restaurant/selection.ts` (optional types)
- Modify: `restaurant-page.tsx`

**Interfaces:**
- Consumes: `useOpenBills({ limit: 200 })`
- Produces: selection state `{ type: "table" | "bill"; tableId?: string; orderId?: string } | null`

- [ ] **Step 1: Bills rail UI**

- List open bills: order number, table label (resolve via tables map), total, relative time
- Click → set selection to that bill
- Double-click / **Open** button → `buildCashierHandoffUrl({ orderId })`
- Empty: “No open bills”
- Loading spinner

- [ ] **Step 2: Sync selection with occupied table clicks**

Selecting occupied table sets selection `{ type: "table", tableId, orderId: active_order?.id }`  
Highlight selected tile + selected bill card with primary ring.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pos): add restaurant open-bills rail and selection model

EOF
)"
```

---

### Task 5: Action rail + wire Split / Move / stubs

**Files:**
- Create: `src/features/pos/restaurant/components/restaurant-action-rail.tsx`
- Modify: `restaurant-page.tsx` — host modals + rail callbacks

**Interfaces:**
- Consumes: selection, `MoveTableModal`, `SplitBillModal`, `buildCashierHandoffUrl`, toast
- Produces: left rail actions per spec §4.1

- [ ] **Step 1: Implement rail buttons**

| Button | Handler |
|---|---|
| Waiting List | `toast.message("Waiting List coming soon")` |
| Order Check | if selection.orderId → push cashier handoff; else toast “Select an occupied table or bill” |
| Pre Settlement | if orderId → `buildCashierHandoffUrl({ orderId, pay: true })` (cashier should open payment when `pay=1` — add small effect in Task 3 follow-up if missing: `if (pay===1 && order loaded) setShowPayment(true)`) |
| Split Bill | open SplitBillModal with selected order object (fetch from open bills list) |
| Move Table | open MoveTableModal |
| Reprint | try sessionStorage key `pos:lastReceipt` if exists; else toast |
| Message | toast coming soon |
| Time | render `HH:mm:ss` updating every 1s |
| View Orders | `router.push` existing orders dashboard path (same as sidebar menu for orders) |

Soft button styles; stack vertically; `w-full`.

- [ ] **Step 2: Ensure cashier opens payment when `pay=1`**

In cashier, after order loaded from `orderId`, if `searchParams.get("pay")==="1"` open payment modal once.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pos): wire restaurant action rail to cashier, split, and move

EOF
)"
```

---

### Task 6: Polish layout + acceptance pass

**Files:**
- Modify restaurant components for final 3-column responsive layout
- Fix any English copy leftovers

- [ ] **Step 1: Layout**

Desktop:

```
grid grid-cols-[140px_1fr_280px] gap-3 min-h-[70vh]
```

Tablet: stack bills below board; rail becomes horizontal wrap.

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/features/pos/restaurant/
```

- [ ] **Step 3: Acceptance checklist** (spec §7) — walk manually; fix blockers.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pos): polish restaurant board layout and acceptance fixes

EOF
)"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| Route + IAM menu | 1 |
| Nav URL contract | 1 |
| Table board by floor + Without/Take Away | 2 |
| Cashier apply table/orderType | 3 |
| Return after pay / open bill | 3 |
| Back to Restaurant | 3 |
| Bills rail + selection | 4 |
| Action rail wiring + stubs | 5 |
| pay=1 pre-settlement | 5 |
| Layout polish | 6 |

## Self-review notes

- No TBD steps; stubs explicitly toast.
- `from=restaurant` string consistent across nav + cashier.
- Cashier redirect only on success paths listed.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-12-pos-restaurant-mode.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task + review between tasks  
2. **Inline Execution** — run tasks in this session with checkpoints  

Which approach?
