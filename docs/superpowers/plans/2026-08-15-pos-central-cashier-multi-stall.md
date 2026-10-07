# POS Kasir Pusat Multi-Stall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kasir pusat melihat menu semua stall, filter stall seperti kategori, dan (fase 2+) bayar 1x dengan data pecah per stall; kasir stall tetap 1 order = 1 stall.

**Architecture:** Gate murni (`canSellMixedStall`) memisahkan kasir pusat dari `can_switch_stall`. Katalog union hanya jika gate lolos + mode `all`. Checkout campur = `pos_checkouts` + child `pos_orders` per stall; 1 stall tetap jalur `POST /api/pos/orders` lama. Tender dan QR Xendit hidup di checkout; laporan/KDS/jurnal tetap baca child.

**Tech Stack:** Next.js App Router, PostgreSQL deltas, IAM menus, Vitest, DialogPanel, existing Xendit QRIS poll.

**Spec:** `docs/superpowers/specs/2026-08-15-pos-central-cashier-multi-stall-design.md`

## Global Constraints

- Settlement / xenPlatform / disbursement out of scope; 1 akun Xendit
- Tidak ada role baru `kasir_pusat`
- Switcher stall tetap; `can_switch_stall` ≠ jual campur
- Parent checkout bukan `pos_orders` (hindari double-count omzet)
- Ganti stall: konfirmasi → clear `pos_cart_state` saja; open bill tersimpan tidak di-void
- Kasir stall selalu transaksi terpisah, tidak auto-merge ke checkout pusat
- Soft borders; DialogPanel `xs` untuk konfirmasi; tombol mutasi wajib loading + toast
- Tes: logika murni (bukan JSX). Runner: `pnpm test -- src/lib/pos/...`

## File map

| File | Role |
|------|------|
| `src/lib/pos/central-cashier.ts` | Gate, keputusan checkout, alokasi charge, phase-1 cart stall |
| `src/lib/pos/central-cashier.test.ts` | Unit tes helper di atas |
| `src/lib/iam/has-menu.ts` | Cek grant menu by code (termasuk `is_visible=false`) |
| `database/migrations/deltas/20260815100000_pos_central_cashier.sql` | Flag user + IAM menu + grant |
| `database/migrations/deltas/20260815110000_pos_checkouts.sql` | Tabel checkout + kolom order |
| `src/lib/pos/stall-product-scope.ts` | Union katalog jika gate lolos |
| `src/lib/pos/pos-sell-stall.ts` | Tetap 1-stall kecuali caller memakai gate |
| `src/components/shared/app-sidebar.tsx` | Semua Stall untuk kasir pusat; dialog clear cart |
| `src/features/pos/cashier/components/cashier-stall-gate.tsx` | Dialog yang sama; skip gate jika kasir pusat |
| `src/features/users/components/stall-assignment-picker.tsx` | Switch Kasir pusat |
| `src/app/api/pos/orders/route.ts` | Branch mixed → checkout + children |
| `src/app/api/pos/checkouts/route.ts` | Prepare unpaid checkout untuk QRIS |
| `src/features/pos/cashier/components/cashier-page.tsx` | Filter stall + cart phase rules |
| `src/features/pos/restaurant/table-board-status.ts` | Occupied jika ada ≥1 tagihan terbuka |

---

## Fase 1 — akses, katalog, switcher (tanpa checkout campur)

### Task 1: Helper gate + cart 1-stall

**Files:**
- Create: `src/lib/pos/central-cashier.ts`
- Test: `src/lib/pos/central-cashier.test.ts`

**Interfaces:**
- Consumes: `ActiveStallMode` dari `src/lib/pos/pos-sell-stall.ts`
- Produces:
  - `CENTRAL_CASHIER_MENU = "pos.cashier.central"`
  - `canSellMixedStall(input: { hasCentralMenu: boolean; canCentralCheckout: boolean; activeMode: ActiveStallMode }): boolean`
  - `uniqueStallIds(warehouseIds: Array<string | null | undefined>): string[]`
  - `shouldCreateCheckout(stallIds: string[]): boolean`
  - `canAddItemToSingleStallCart(existingStallIds: string[], incomingWarehouseId: string | null | undefined): { ok: true } | { ok: false; message: string }`
  - `shouldConfirmClearCart(raw: string | null | undefined): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  canAddItemToSingleStallCart,
  canSellMixedStall,
  shouldConfirmClearCart,
  shouldCreateCheckout,
  uniqueStallIds,
} from "./central-cashier";

describe("canSellMixedStall", () => {
  it("requires menu + user flag + mode all", () => {
    expect(
      canSellMixedStall({
        hasCentralMenu: true,
        canCentralCheckout: true,
        activeMode: "all",
      })
    ).toBe(true);
  });

  it("rejects switch-only or single stall mode", () => {
    expect(
      canSellMixedStall({
        hasCentralMenu: true,
        canCentralCheckout: false,
        activeMode: "all",
      })
    ).toBe(false);
    expect(
      canSellMixedStall({
        hasCentralMenu: true,
        canCentralCheckout: true,
        activeMode: "stall",
      })
    ).toBe(false);
  });
});

describe("checkout decision", () => {
  it("creates checkout only for 2+ stalls", () => {
    expect(uniqueStallIds(["w-a", "w-a", "w-b"])).toEqual(["w-a", "w-b"]);
    expect(shouldCreateCheckout(["w-a"])).toBe(false);
    expect(shouldCreateCheckout(["w-a", "w-b"])).toBe(true);
  });
});

describe("phase-1 single-stall cart", () => {
  it("allows first item and same stall", () => {
    expect(canAddItemToSingleStallCart([], "w-a")).toEqual({ ok: true });
    expect(canAddItemToSingleStallCart(["w-a"], "w-a")).toEqual({ ok: true });
  });

  it("rejects missing or other stall", () => {
    expect(canAddItemToSingleStallCart(["w-a"], "w-b").ok).toBe(false);
    expect(canAddItemToSingleStallCart([], null).ok).toBe(false);
  });
});

describe("shouldConfirmClearCart", () => {
  it("is true only when draft cart has items", () => {
    expect(shouldConfirmClearCart(JSON.stringify({ items: [{ id: "1" }] }))).toBe(true);
    expect(shouldConfirmClearCart(JSON.stringify({ items: [] }))).toBe(false);
    expect(shouldConfirmClearCart(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/pos/central-cashier.test.ts`
Expected: FAIL — `Cannot find module './central-cashier'`

- [ ] **Step 3: Write minimal implementation**

```ts
import {
  posCartHasItems,
  type ActiveStallMode,
} from "@/lib/pos/pos-sell-stall";

export const CENTRAL_CASHIER_MENU = "pos.cashier.central";

export function canSellMixedStall(input: {
  hasCentralMenu: boolean;
  canCentralCheckout: boolean;
  activeMode: ActiveStallMode;
}): boolean {
  return (
    input.hasCentralMenu &&
    input.canCentralCheckout &&
    input.activeMode === "all"
  );
}

export function uniqueStallIds(
  warehouseIds: Array<string | null | undefined>
): string[] {
  return [...new Set(warehouseIds.filter((id): id is string => Boolean(id)))];
}

export function shouldCreateCheckout(stallIds: string[]): boolean {
  return uniqueStallIds(stallIds).length >= 2;
}

export function canAddItemToSingleStallCart(
  existingStallIds: string[],
  incomingWarehouseId: string | null | undefined
): { ok: true } | { ok: false; message: string } {
  if (!incomingWarehouseId) {
    return {
      ok: false,
      message: "Ada produk tanpa stall — tidak bisa dimasukkan ke keranjang",
    };
  }
  const existing = uniqueStallIds(existingStallIds);
  if (existing.length === 0 || existing[0] === incomingWarehouseId) {
    return { ok: true };
  }
  return {
    ok: false,
    message:
      "Keranjang hanya boleh dari satu stall. Kosongkan keranjang atau ganti filter stall",
  };
}

export function shouldConfirmClearCart(raw: string | null | undefined): boolean {
  return posCartHasItems(raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/pos/central-cashier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pos/central-cashier.ts src/lib/pos/central-cashier.test.ts
git commit -m "$(cat <<'EOF'
feat(pos): add central cashier gate helpers

EOF
)"
```

---

### Task 2: IAM menu + flag user

**Files:**
- Create: `database/migrations/deltas/20260815100000_pos_central_cashier.sql`
- Modify: `database/seeders/iam-menus.sql` — tambah row menu + whitelist `pos.cashier.central` di `code NOT IN (...)`

**Interfaces:**
- Consumes: `CENTRAL_CASHIER_MENU`
- Produces: kolom `configuration.users.can_central_checkout boolean NOT NULL DEFAULT false`; menu IAM `pos.cashier.central` (`is_visible=false`, parent `pos.operations`); grant `read` ke role `super_admin`, `admin`, `pos_supervisor`, `pos`

- [ ] **Step 1: Write the delta**

```sql
ALTER TABLE configuration.users
  ADD COLUMN IF NOT EXISTS can_central_checkout boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN configuration.users.can_central_checkout IS
  'User ditugaskan jaga kasir pusat. Harus plus IAM pos.cashier.central.';

INSERT INTO iam.menus (
  code, menu_name, route_path, icon, menu_type, order_number, permission_context,
  is_visible
)
VALUES (
  'pos.cashier.central',
  'Kasir Pusat',
  NULL,
  'shopping',
  'sidebar',
  12,
  '{"actions":["read"]}'::jsonb,
  false
)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  is_visible = false,
  is_active = true,
  deleted_at = NULL,
  updated_at = now();

UPDATE iam.menus SET module = 'pos', level = 3
WHERE code = 'pos.cashier.central';

UPDATE iam.menus child
SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'pos.cashier.central'
  AND parent.code = 'pos.operations';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, '["read"]'::jsonb, true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'pos_supervisor', 'pos')
  AND m.code = 'pos.cashier.central'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();
```

- [ ] **Step 2: Seed whitelist**

Di `database/seeders/iam-menus.sql`:
1. Tambah tuple VALUES bersama menu POS lain:
   `('pos.cashier.central', 'Kasir Pusat', NULL, 'shopping', 'sidebar', 12, '{"actions":["read"]}'::jsonb)`
2. Tambah `'pos.cashier.central'` ke daftar `code NOT IN (...)` (sebelum `pos.kitchen.queue-board` penutup).

- [ ] **Step 3: Commit**

```bash
git add database/migrations/deltas/20260815100000_pos_central_cashier.sql database/seeders/iam-menus.sql
git commit -m "$(cat <<'EOF'
feat(pos): add kasir pusat IAM menu and user flag

EOF
)"
```

---

### Task 3: Cek grant menu (termasuk hidden)

**Files:**
- Create: `src/lib/iam/has-menu.ts`
- Test: `src/lib/iam/has-menu.test.ts`

**Interfaces:**
- Consumes: IAM tables via `iamDbQuery`
- Produces: `hasIamMenuCode(grantedCodes: string[], code: string): boolean`; `loadGrantedMenuCodes(roleIds: string[]): Promise<string[]>` (SQL **tanpa** filter `is_visible`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { hasIamMenuCode } from "./has-menu";

describe("hasIamMenuCode", () => {
  it("matches exact code", () => {
    expect(hasIamMenuCode(["pos.operations.cashier", "pos.cashier.central"], "pos.cashier.central")).toBe(true);
    expect(hasIamMenuCode(["pos.operations.cashier"], "pos.cashier.central")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/iam/has-menu.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```ts
import { iamDbQuery } from "@/lib/iam/pg-client";

export function hasIamMenuCode(grantedCodes: string[], code: string): boolean {
  return grantedCodes.includes(code);
}

export async function loadGrantedMenuCodes(roleIds: string[]): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const rows = await iamDbQuery<{ code: string }>(
    `SELECT DISTINCT m.code
     FROM iam.role_menu_permissions rmp
     JOIN iam.menus m ON m.id = rmp.menu_id
     WHERE rmp.role_id = ANY($1::uuid[])
       AND rmp.is_active = true
       AND m.deleted_at IS NULL
       AND m.is_active = true`,
    [roleIds]
  );
  return rows.map((row) => row.code);
}
```

Jangan pakai `fetchMenusByIds` existing — itu membuang `is_visible=false`.

- [ ] **Step 4: Run tests**

Run: `pnpm test -- src/lib/iam/has-menu.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/iam/has-menu.ts src/lib/iam/has-menu.test.ts
git commit -m "$(cat <<'EOF'
feat(iam): resolve hidden menu grants by code

EOF
)"
```

---

### Task 4: Form user — switch Kasir pusat

**Files:**
- Modify: `src/features/users/types.ts` — `can_central_checkout: boolean` di `UserEmployeeFormValues`
- Modify: `src/features/users/constants/index.ts` — default `false`
- Modify: `src/lib/users/schemas.ts` — `can_central_checkout: z.boolean().optional()` di `businessScopeFieldsSchema`
- Modify: `src/lib/users/user-mapper.ts` — map `canCentralCheckout`
- Modify: `src/lib/users/user-service.ts` — `stallProfileFields` + create/update baca flag; jika `can_central_checkout` true maka `can_switch_stall` dipaksa true
- Modify: `src/features/users/components/stall-assignment-picker.tsx` — switch kedua
- Modify: `src/features/users/components/user-form-page.tsx` + `create-account-dialog.tsx` + `app-access-form-section.tsx` — pass prop
- Modify: `src/lib/users/schemas.test.ts` + `src/features/users/constants/index.test.ts` — default false

**Interfaces:**
- Consumes: kolom `can_central_checkout`
- Produces: form field `can_central_checkout`; server persist; On → `can_switch_stall=true`

- [ ] **Step 1: Extend picker**

Tambah switch di bawah "Boleh pindah stall" (pola yang sama, `border-gray-200/70`):

```tsx
<p className="text-sm font-medium text-foreground">Kasir pusat</p>
<p className="mt-0.5 text-xs text-muted-foreground">
  Boleh transaksi Semua Stall (katalog semua menu). Tetap butuh permission
  POS Kasir Pusat di role.
</p>
<Switch
  checked={canCentralCheckout}
  onCheckedChange={(checked) =>
    onChange({
      can_central_checkout: checked,
      can_switch_stall: checked ? true : canSwitchStall,
    })
  }
/>
```

Tampilkan switch ini hanya jika parent mengirim `showCentralCheckout` (nanti dari role yang punya menu; MVP: tampilkan untuk `is_access_app` + `business_scope === "branch"` sama seperti stall picker).

- [ ] **Step 2: Persist**

Di `stallProfileFields`:

```ts
can_central_checkout: input.can_central_checkout === true,
can_switch_stall:
  input.can_central_checkout === true || input.can_switch_stall === true,
```

Select/insert/update `configuration.users` wajib include kolom baru (sama pola `can_switch_stall`).

- [ ] **Step 3: Tes schema default**

Pastikan `emptyUserForm.can_central_checkout === false` di `src/features/users/constants/index.test.ts`.

Run: `pnpm test -- src/features/users/constants/index.test.ts src/lib/users/schemas.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/features/users src/lib/users
git commit -m "$(cat <<'EOF'
feat(users): add kasir pusat assignment switch

EOF
)"
```

---

### Task 5: Session + katalog union

**Files:**
- Modify: `src/lib/auth/require-user.ts` — select `can_central_checkout`; attach `can_central_checkout` + `has_central_cashier_menu`
- Modify: `src/lib/pos/pos-sell-stall-server.ts` — load flag + menu; jika `canSellMixedStall` maka **jangan** dipakai untuk memaksa 1 warehouse (katalog)
- Modify: `src/lib/pos/stall-product-scope.ts` — jika gate lolos, `warehouseIds` = semua stall `getStallAccess`, `mode: "ids"` union (bukan `mode: "all"` tanpa filter produk)
- Modify: `src/app/api/pos/products/route.ts` — setiap produk include `warehouse_id` + `warehouse_name`
- Modify: `src/lib/pos-api.ts` — `Product.warehouse_id?: string; warehouse_name?: string`
- Modify: `src/app/dashboard/pos/layout.tsx` — teruskan flag ke client jika layout sudah pass user

**Interfaces:**
- Consumes: `canSellMixedStall`, `loadGrantedMenuCodes`, `CENTRAL_CASHIER_MENU`
- Produces: `AuthUser.can_central_checkout: boolean`; `AuthUser.has_central_cashier_menu: boolean`; katalog union saat gate true

- [ ] **Step 1: Extend `resolvePosProductStallScope`**

```ts
const flags = await queryOne<{
  can_central_checkout: boolean;
  can_switch_stall: boolean;
}>(...);
const hasMenu = hasIamMenuCode(await loadGrantedMenuCodes(roleIds), CENTRAL_CASHIER_MENU);
const active = await resolveActiveStallFromCookies();

if (
  canSellMixedStall({
    hasCentralMenu: hasMenu,
    canCentralCheckout: flags?.can_central_checkout === true,
    activeMode: active.mode,
  })
) {
  const access = await getStallAccess(userId, role, branchId);
  const warehouseIds = access.stalls.map((s) => s.id);
  const productIds = await loadProductIdsForWarehouses(warehouseIds);
  return { mode: "ids", productIds, warehouseIds };
}

// else existing resolvePosSellStallForUser path
```

Produk GET: join `item.products.warehouse_id` + `configuration.warehouses.name` (sudah ada pola di `loadPosProductWarehouseIds`).

- [ ] **Step 2: Kasir tanpa gate tetap kosong di mode `all`**

Jangan ubah `resolvePosSellStall` untuk user biasa. Tes existing:

Run: `pnpm test -- src/lib/pos/pos-sell-stall.test.ts`
Expected: PASS — "rejects Semua Stall mode" tetap

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/require-user.ts src/lib/pos/pos-sell-stall-server.ts src/lib/pos/stall-product-scope.ts src/app/api/pos/products/route.ts src/lib/pos-api.ts src/app/dashboard/pos/layout.tsx
git commit -m "$(cat <<'EOF'
feat(pos): load all-stall catalog for central cashier

EOF
)"
```

---

### Task 6: Switcher — Semua Stall + konfirmasi clear cart

**Files:**
- Modify: `src/components/shared/app-sidebar.tsx` — `StallSwitcher`
- Modify: `src/features/pos/cashier/components/cashier-stall-gate.tsx`
- Create: `src/components/pos/confirm-stall-switch-dialog.tsx` (DialogPanel `xs`)

**Interfaces:**
- Consumes: `shouldConfirmClearCart`, `POS_CART_STORAGE_KEY`, `user.has_central_cashier_menu && user.can_central_checkout`
- Produces: `confirmAndSwitchStall(warehouseId: string | null): Promise<void>`

- [ ] **Step 1: Dialog**

Pakai `DialogPanel` `xs` dari `@/components/ui/dialog`:

- Title: `Ganti stall`
- Description: `Keranjang akan dikosongkan karena stall diganti. Lanjut?`
- Footer: Batal (outline) + Ganti stall (primary, loading + disabled saat `switching`)

Pada konfirmasi:

```ts
try {
  localStorage.removeItem(POS_CART_STORAGE_KEY);
} catch {
  toast.error("Keranjang mungkin masih tersisa di perangkat ini");
}
await fetch("/api/auth/active-stall", { ... });
window.location.reload();
```

Jika `shouldConfirmClearCart` false: langsung switch tanpa dialog.

- [ ] **Step 2: Tampilkan Semua Stall**

Ganti:

```ts
const hideAllStallsOption =
  (pathname.includes("/cashier") || pathname.includes("/restaurant")) &&
  !canUseCentralCashier;
```

`canUseCentralCashier` = menu + flag user (bukan `can_switch_stall` saja). Banner amber "wajib pilih satu stall" hanya jika `hideAllStallsOption`.

`CashierStallGate`: jika `canUseCentralCashier` dan mode `all`, **jangan** overlay. Overlay tetap untuk user biasa di `all` / `no_stall`.

- [ ] **Step 3: Commit**

```bash
git add src/components/pos/confirm-stall-switch-dialog.tsx src/components/shared/app-sidebar.tsx src/features/pos/cashier/components/cashier-stall-gate.tsx
git commit -m "$(cat <<'EOF'
feat(pos): confirm and clear cart when switching stall

EOF
)"
```

---

### Task 7: Filter stall + phase-1 cart guard

**Files:**
- Modify: `src/features/pos/cashier/components/cashier-page.tsx` (~212, ~691, ~2051)
- Modify: `src/hooks/use-pos-cart.ts` — simpan `warehouse_id` per item; guard add
- Modify: `src/hooks/use-pos-products.ts` — jangan set `stallBlockedReason` untuk `all_stalls` jika katalog terisi

**Interfaces:**
- Consumes: `canAddItemToSingleStallCart`, `Product.warehouse_id`
- Produces: `selectedStallFilter: "All" | warehouseId`; add-to-cart toast error jika beda stall (fase 1)

- [ ] **Step 1: Filter chips**

Di atas row kategori, jika `canUseCentralCashier && activeMode === "all"`:

```tsx
const stallFilters = [
  { id: "All", label: "Semua stall" },
  ...uniqueStallsFromProducts,
];
```

Filter produk:

```ts
const okStall =
  selectedStallFilter === "All" ||
  product.warehouse_id === selectedStallFilter;
const okCat =
  selectedCategory === "All" ||
  (product.category?.name || "Uncategorized") === selectedCategory;
```

Style chip sama kategori (`bg-primary` aktif, `bg-gray-100` idle). Soft border saja.

- [ ] **Step 2: Add to cart**

Sebelum push item:

```ts
const existing = cart.items.map((item) => item.warehouse_id);
const check = canAddItemToSingleStallCart(existing, product.warehouse_id);
if (!check.ok) {
  toast.error(check.message);
  return;
}
```

Checkout fase 1 tetap `POST /api/pos/orders` + `assertOrderItemsMatchSellStall`. Untuk kasir pusat mode `all` dengan 1 stall di cart: `resolvePosSellStallForUser` masih gagal (`all_stalls`).

Perbaikan wajib di Task 5/7 server: jika **bukan** mixed (1 stall di items) dan user kasir pusat mode `all`, jual ke `warehouse_id` item itu.

Di `src/app/api/pos/orders/route.ts` setelah load items:

```ts
const itemWarehouses = [...warehouseByProduct values];
const stallIds = uniqueStallIds(itemWarehouses);
if (stallIds.length === 1 && canSellMixedStall(...)) {
  // skip resolvePosSellStall all_stalls; assert items match stallIds[0]
  sellWarehouseId = stallIds[0];
} else {
  // existing resolvePosSellStallForUser
}
```

Tanpa ini kasir pusat tidak bisa checkout 1 stall dari mode Semua Stall.

- [ ] **Step 3: Tes existing sell-stall + helper**

Run: `pnpm test -- src/lib/pos/central-cashier.test.ts src/lib/pos/pos-sell-stall.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/features/pos/cashier/components/cashier-page.tsx src/hooks/use-pos-cart.ts src/hooks/use-pos-products.ts src/app/api/pos/orders/route.ts
git commit -m "$(cat <<'EOF'
feat(pos): stall filter and single-stall checkout from all mode

EOF
)"
```

Fase 1 selesai jika: kasir pusat melihat semua menu, filter stall, checkout 1 stall berhasil, campur ditolak toast, switcher konfirmasi clear cart.

---

## Fase 2 — checkout campur + bayar 1x

### Task 8: Alokasi charge

**Files:**
- Modify: `src/lib/pos/central-cashier.ts`
- Modify: `src/lib/pos/central-cashier.test.ts`

**Interfaces:**
- Produces: `allocateCheckoutCharges(input: { slices: { warehouseId: string; subtotal: number }[]; discount: number; tax: number; serviceCharge: number; otherCharges: number }): { warehouseId: string; subtotal: number; discount: number; tax: number; serviceCharge: number; otherCharges: number; total: number }[]`

- [ ] **Step 1: Write the failing test**

```ts
describe("allocateCheckoutCharges", () => {
  it("splits proportionally and puts remainder on largest slice", () => {
    const rows = allocateCheckoutCharges({
      slices: [
        { warehouseId: "w-a", subtotal: 10000 },
        { warehouseId: "w-b", subtotal: 5000 },
      ],
      discount: 1500,
      tax: 1350,
      serviceCharge: 0,
      otherCharges: 0,
    });
    expect(rows[0].discount + rows[1].discount).toBe(1500);
    expect(rows[0].tax + rows[1].tax).toBe(1350);
    expect(rows[0].warehouseId).toBe("w-a");
    expect(rows[0].discount).toBe(1000);
    expect(rows[1].discount).toBe(500);
  });

  it("returns zeros when checkout subtotal is 0", () => {
    const rows = allocateCheckoutCharges({
      slices: [{ warehouseId: "w-a", subtotal: 0 }],
      discount: 0,
      tax: 0,
      serviceCharge: 0,
      otherCharges: 0,
    });
    expect(rows[0].total).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/pos/central-cashier.test.ts`
Expected: FAIL — `allocateCheckoutCharges` is not a function

- [ ] **Step 3: Implement**

```ts
export type CheckoutChargeSlice = {
  warehouseId: string;
  subtotal: number;
};

export type AllocatedCheckoutSlice = CheckoutChargeSlice & {
  discount: number;
  tax: number;
  serviceCharge: number;
  otherCharges: number;
  total: number;
};

function allocateAmount(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => Math.floor((total * w) / sum));
  let remainder = total - raw.reduce((a, b) => a + b, 0);
  const largest = weights.indexOf(Math.max(...weights));
  if (remainder !== 0 && largest >= 0) raw[largest] += remainder;
  return raw;
}

export function allocateCheckoutCharges(input: {
  slices: CheckoutChargeSlice[];
  discount: number;
  tax: number;
  serviceCharge: number;
  otherCharges: number;
}): AllocatedCheckoutSlice[] {
  const weights = input.slices.map((s) => s.subtotal);
  const discounts = allocateAmount(input.discount, weights);
  const taxes = allocateAmount(input.tax, weights);
  const services = allocateAmount(input.serviceCharge, weights);
  const others = allocateAmount(input.otherCharges, weights);
  return input.slices.map((slice, index) => {
    const discount = discounts[index] ?? 0;
    const tax = taxes[index] ?? 0;
    const serviceCharge = services[index] ?? 0;
    const otherCharges = others[index] ?? 0;
    return {
      ...slice,
      discount,
      tax,
      serviceCharge,
      otherCharges,
      total: slice.subtotal - discount + tax + serviceCharge + otherCharges,
    };
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- src/lib/pos/central-cashier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pos/central-cashier.ts src/lib/pos/central-cashier.test.ts
git commit -m "$(cat <<'EOF'
feat(pos): allocate mixed-checkout charges per stall

EOF
)"
```

---

### Task 9: Schema checkout

**Files:**
- Create: `database/migrations/deltas/20260815110000_pos_checkouts.sql`

**Interfaces:**
- Produces: `pos.pos_checkouts` (kolom sesuai spec); `pos.pos_orders.checkout_id uuid NULL REFERENCES pos.pos_checkouts(id)`; `pos.pos_orders.sold_from varchar(16) NOT NULL DEFAULT 'stall'` check `IN ('central','stall')`; index `(checkout_id)`, `(table_id, payment_status)`

- [ ] **Step 1: Write delta**

```sql
CREATE TABLE IF NOT EXISTS pos.pos_checkouts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  checkout_number varchar(32) NOT NULL UNIQUE,
  queue_number varchar(16),
  company_id uuid,
  branch_id uuid,
  table_id text,
  customer_id uuid,
  cashier_id uuid NOT NULL,
  shift_id uuid,
  payment_method pos_payment_method,
  payment_status pos_payment_status NOT NULL DEFAULT 'unpaid',
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  service_charge_amount numeric(12,2) NOT NULL DEFAULT 0,
  other_charges_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  change_amount numeric(12,2) NOT NULL DEFAULT 0,
  xendit_qr_id text,
  xendit_external_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_checkouts_table
  ON pos.pos_checkouts (table_id, payment_status);

ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS checkout_id uuid REFERENCES pos.pos_checkouts(id);

ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS sold_from varchar(16) NOT NULL DEFAULT 'stall';

ALTER TABLE pos.pos_orders
  DROP CONSTRAINT IF EXISTS pos_orders_sold_from_check;

ALTER TABLE pos.pos_orders
  ADD CONSTRAINT pos_orders_sold_from_check
  CHECK (sold_from IN ('central', 'stall'));

CREATE INDEX IF NOT EXISTS idx_pos_orders_checkout_id
  ON pos.pos_orders (checkout_id);
```

- [ ] **Step 2: Commit**

```bash
git add database/migrations/deltas/20260815110000_pos_checkouts.sql
git commit -m "$(cat <<'EOF'
feat(pos): add pos_checkouts and order checkout_id

EOF
)"
```

---

### Task 10: API mixed checkout + QRIS 1 QR

**Files:**
- Create: `src/lib/pos/create-mixed-checkout.ts` — insert checkout + children dalam 1 transaksi `pg`
- Create: `src/app/api/pos/checkouts/route.ts` — `POST` prepare unpaid (QRIS) atau paid (cash)
- Modify: `src/app/api/pos/orders/route.ts` — jika `shouldCreateCheckout(stallIds)`:
  - tanpa gate → 400 `"Keranjang campur stall hanya untuk kasir pusat"`
  - dengan gate → delegasi `createMixedCheckout`
- Modify: `src/app/api/pos/qris/route.ts` — terima `checkout_id`, amount = checkout.total, simpan `xendit_qr_id` / `xendit_external_id`
- Modify: `src/lib/pos-api.ts` — tipe `CreateCheckoutRequest`

**Interfaces:**
- Consumes: `shouldCreateCheckout`, `allocateCheckoutCharges`, `canSellMixedStall`, `generate_queue_number` existing
- Produces: `createMixedCheckout(input): Promise<{ checkoutId: string; checkoutNumber: string; queueNumber: string; orderIds: string[] }>`
  - Child: `warehouse_id` = stall, `checkout_id` set, `sold_from='central'`, `payment_status` = checkout, `queue_number` = checkout
  - 1 stall: jangan panggil ini; `sold_from='central'` jika kasir pusat

- [ ] **Step 1: Guard tes murni (sudah ada `shouldCreateCheckout`)**

Di route, urutan:

1. Load warehouse tiap `product_id` (`loadPosProductWarehouseIds`).
2. Tolak item `warehouse_id` null (400, pesan spec).
3. `stallIds = uniqueStallIds(...)`.
4. Jika `stallIds.length >= 2` && !`canSellMixedStall` → 400.
5. Jika `stallIds.length >= 2` && gate → `createMixedCheckout` (bukan insert 1 order).
6. Jika `stallIds.length === 1` → jalur lama; set `sold_from` central/stall.

QRIS campur:

1. `POST /api/pos/checkouts` body items + totals, `payment_status=unpaid`, **tanpa child**.
2. `POST /api/pos/qris` `{ checkout_id, amount }`.
3. Poll existing `GET /api/pos/qris/[id]/status`.
4. Saat paid: `POST /api/pos/checkouts/[id]/complete` memanggil `completeMixedCheckout(checkoutId)` (buat children atomically). Jika child gagal: checkout tetap `paid`, jangan buat QR baru (lookup `xendit_external_id`).

Cash/debit/ARK: `POST /api/pos/checkouts` langsung `paid` + children 1 transaksi.

Jurnal: panggil hook existing per **child id** setelah lunas (jangan journal checkout).

- [ ] **Step 2: Commit**

```bash
git add src/lib/pos/create-mixed-checkout.ts src/app/api/pos/checkouts src/app/api/pos/orders/route.ts src/app/api/pos/qris/route.ts src/lib/pos-api.ts
git commit -m "$(cat <<'EOF'
feat(pos): create mixed checkout with one payment

EOF
)"
```

---

### Task 11: Kasir UI campur + struk

**Files:**
- Modify: `src/features/pos/cashier/components/cashier-page.tsx` — hapus `canAddItemToSingleStallCart` saat `canSellMixedStall`; izinkan campur
- Modify: `src/components/pos/PaymentModal.tsx` — QRIS pakai `checkout_id` jika cart ≥2 stall
- Modify: print receipt builder (cari `buildReceipt` / thermal payload di `src/lib/pos/`) — group item by `warehouse_name`, header `checkout_number`

**Interfaces:**
- Consumes: `shouldCreateCheckout`, checkout API
- Produces: 1 struk tamu; toast sukses sekali (jangan dobel)

- [ ] **Step 1: Add-to-cart**

```ts
if (!canSellMixedStall(gate)) {
  const check = canAddItemToSingleStallCart(existing, product.warehouse_id);
  if (!check.ok) { toast.error(check.message); return; }
}
```

Payment: hitung `stallIds` dari cart; jika ≥2 panggil checkout API, bukan `createOrder`.
Split bill tamu pada checkout campur: tolak 400 `"Split bill belum didukung untuk checkout multi-stall"` (tender tunggal). Jangan reuse `pos_order_splits` di parent yang bukan `pos_orders`.

- [ ] **Step 2: Struk**

Header: `checkout_number` + 1 `queue_number`. Body: section per stall. Footer: 1 total + 1 metode.

- [ ] **Step 3: Commit**

```bash
git add src/features/pos/cashier/components/cashier-page.tsx src/components/pos/PaymentModal.tsx src/lib/pos
git commit -m "$(cat <<'EOF'
feat(pos): allow mixed cart and grouped receipt

EOF
)"
```

---

## Fase 3 — restaurant multi-bill

### Task 12: Meja boleh banyak tagihan

**Files:**
- Modify: `src/app/api/pos/orders/[id]/table/route.ts` — hapus 409 `Table is occupied` (tetap tolak move order finished)
- Modify: `src/app/api/pos/orders/[id]/transfer-items/route.ts` — izinkan target meja yang sudah ber-order
- Modify: `src/features/pos/restaurant/table-board-status.ts` — `activeOrders: TableBoardActiveOrder[]`; occupied jika ada yang belum paid; billing jika **salah satu** `pre_settled_at`
- Modify: `src/features/pos/restaurant/table-board-status.test.ts`
- Modify: `src/features/pos/restaurant/components/restaurant-bills-rail.tsx` + board detail — list semua open bill + checkout unpaid di `table_id` yang sama
- Modify: open-bill create: kasir stall selalu order baru (`checkout_id` null, `sold_from=stall`). Kasir pusat campur → checkout `table_id` set; append item ke checkout pusat **unpaid milik kasir pusat di meja itu** (bukan ke order stall)

**Interfaces:**
- Consumes: `pos_checkouts.table_id`, `pos_orders.table_id`
- Produces: `resolveTableBoardStatus({ activeOrders })`; floor menampilkan N tagihan

- [ ] **Step 1: Update tes status**

```ts
it("is occupied when any unpaid order exists", () => {
  expect(
    resolveTableBoardStatus({
      activeOrders: [{ payment_status: "unpaid" }, { payment_status: "paid" }],
    })
  ).toBe("occupied");
});
```

Ubah fungsi ke array; adapter di board: `activeOrders = orders.filter(table)`.

- [ ] **Step 2: Run**

Run: `pnpm test -- src/features/pos/restaurant/table-board-status.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/api/pos/orders src/features/pos/restaurant
git commit -m "$(cat <<'EOF'
feat(pos): allow multiple open bills per table

EOF
)"
```

---

## Fase 4 — KDS + antrian

### Task 13: KDS per child + 1 nomor tamu

**Files:**
- Modify: `src/app/api/pos/kds/route.ts` — filter optional `warehouse_id`; **jangan** query `pos_checkouts` sebagai tiket
- Modify: `src/features/pos/kds/components/kds-page.tsx` — dropdown stall (Semua / stall)
- Modify: `src/features/pos/queue-board` — baris = checkout (jika `checkout_id`) **atau** order stall; dedupe by `checkout_id` supaya 3 child tidak jadi 3 nomor
- Modify: `createMixedCheckout` — `queue_number` sekali di checkout, copy ke child

**Interfaces:**
- Consumes: `pos_orders.warehouse_id`, `pos_orders.checkout_id`, `pos_checkouts.queue_number`
- Produces: KDS tickets = orders only; TV 1 baris per checkout

- [ ] **Step 1: Dedup helper + tes**

Create `src/lib/pos/queue-board-rows.ts`:

```ts
export function uniqueQueueRows<T extends { checkout_id?: string | null; id: string; queue_number?: string | null }>(
  orders: T[]
): T[] {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const order of orders) {
    const key = order.checkout_id || order.id;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(order);
  }
  return rows;
}
```

Test: 3 child `checkout_id` sama → 1 row; 1 order stall → 1 row.

Run: `pnpm test -- src/lib/pos/queue-board-rows.test.ts`
Expected: PASS

- [ ] **Step 2: Commit**

```bash
git add src/lib/pos/queue-board-rows.ts src/lib/pos/queue-board-rows.test.ts src/app/api/pos/kds/route.ts src/features/pos/kds src/features/pos/queue-board
git commit -m "$(cat <<'EOF'
feat(pos): kds stall filter and single guest queue number

EOF
)"
```

---

## Fase 5 — laporan + webhook

### Task 14: Laporan tanpa double-count

**Files:**
- Modify: `src/app/api/pos/reports/transactions/route.ts` — tetap `pos_orders.warehouse_id`; kolom opsional `checkout_number` / `sold_from` via join
- Modify: `src/app/api/pos/reports/product-sales/route.ts` — tidak join checkout ke omzet
- Modify: `src/app/api/pos/shifts/[id]/close/route.ts` — jumlahkan `pos_orders` saja

**Interfaces:**
- Consumes: `checkout_id`, `sold_from`
- Produces: omzet stall = Σ order (child + stall); checkout tidak dijumlah

Tidak perlu tes SQL. Helper murni jika ada filter:

```ts
export function isRevenueOrder(_order: { checkout_id?: string | null }): boolean {
  return true; // semua pos_orders adalah revenue; checkout table bukan
}
```

- [ ] **Step 1: Commit setelah join tampil di response transaksi**

```bash
git add src/app/api/pos/reports src/app/api/pos/shifts
git commit -m "$(cat <<'EOF'
feat(pos): show checkout link on stall revenue reports

EOF
)"
```

---

### Task 15: Webhook Xendit sale (pengerasan)

**Files:**
- Modify: `src/app/api/payments/xendit/webhook/route.ts` — selain topup ARK: jika `external_id` match `pos_checkouts.xendit_external_id` dan belum ada child, panggil `completeMixedCheckout(checkoutId)`
- Idempoten: jika child sudah ada, 200 no-op

**Interfaces:**
- Consumes: `pos_checkouts.xendit_external_id`
- Produces: complete children tanpa QR kedua

- [ ] **Step 1: Commit**

```bash
git add src/app/api/payments/xendit/webhook/route.ts src/lib/pos/create-mixed-checkout.ts
git commit -m "$(cat <<'EOF'
feat(pos): complete mixed checkout from xendit webhook

EOF
)"
```

---

## Verify (setiap fase)

```bash
pnpm test -- src/lib/pos/central-cashier.test.ts src/lib/pos/pos-sell-stall.test.ts src/lib/iam/has-menu.test.ts src/lib/pos/queue-board-rows.test.ts src/features/pos/restaurant/table-board-status.test.ts src/features/users/constants/index.test.ts
```

Expected: PASS semua.

Manual fase 1: user Kasir pusat On → kasir Semua Stall → filter stall → checkout 1 stall. User kasir stall: perilaku lama. Ganti stall + isi cart → dialog → cart kosong.

Manual fase 2: campur 2 stall → 1 QR / 1 cash → 2 `pos_orders` + 1 checkout.

---

## Spec coverage

| Spec section | Task |
|--------------|------|
| Gate IAM + flag + mode all | 1, 3, 5 |
| Setting user switch | 2, 4 |
| Katalog union + filter stall | 5, 7 |
| Switch confirm clear draft | 6 |
| 1 stall = order biasa | 7, 10 |
| Checkout + child + alokasi | 8, 9, 10 |
| Payment 1x + Xendit 1 QR | 10, 11, 15 |
| Meja multi-bill, stall terpisah | 12 |
| KDS child + 1 antrian | 13 |
| Laporan no double-count | 14 |
| Out of scope xenPlatform | tidak dikerjakan |
