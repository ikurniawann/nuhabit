# Task 6 Report — Switcher: Semua Stall + konfirmasi clear cart

**Status:** DONE  
**Commit:** `061a2a69` `feat(pos): confirm and clear cart when switching stall`  
**Branch:** `feature/pos-central-cashier`

## What shipped

Ganti stall no longer blocks when the POS draft cart has items. Empty cart switches immediately; a filled cart opens a confirm dialog, then clears `pos_cart_state` and posts the new stall.

Kasir pusat (menu `pos.cashier.central` **and** `can_central_checkout`) can pick **Semua Stall** on cashier/restaurant paths. Regular cashiers still hide that option and still get the amber “wajib pilih satu stall” banner.

## Files

| Path | Change |
|------|--------|
| `src/components/pos/confirm-stall-switch-dialog.tsx` | **Created.** `DialogPanel` `xs`, hook `useConfirmAndSwitchStall` → `confirmAndSwitchStall(warehouseId)`, plus `CanUseCentralCashierProvider` / `useCanUseCentralCashier`. |
| `src/components/shared/app-sidebar.tsx` | StallSwitcher uses confirm flow; `hideAllStallsOption` gated by `canUseCentralCashier`; provider wraps chrome **and** immersive shells. |
| `src/features/pos/cashier/components/cashier-stall-gate.tsx` | Skip overlay when `canUseCentralCashier` and mode `all` / `all_stalls`. Same confirm flow when picking a stall. Overlay kept for regular users and for `no_stall`. |
| `src/app/dashboard/(dashboard)/layout.tsx` | Forwards `can_central_checkout` and `has_central_cashier_menu` into `AppSidebar` (cashier-new, cashier-fullscreen, restaurant-tablet, tablet redirect). |

`src/app/dashboard/pos/layout.tsx` already forwarded both flags (Task 5). Restaurant desktop (`/dashboard/pos/restaurant`) uses that layout.

## Dialog (verbatim)

- Title: `Ganti stall`
- Description: `Keranjang akan dikosongkan karena stall diganti. Lanjut?`
- Footer: Batal (outline) + Ganti stall (primary, loading + disabled while `switching`)
- Soft borders via shared `DialogPanel` `xs`

On confirm:

1. `localStorage.removeItem(POS_CART_STORAGE_KEY)` — if it throws: toast `Keranjang mungkin masih tersisa di perangkat ini`, then still POST
2. `POST /api/auth/active-stall`
3. `window.location.reload()`
4. Toast on POST failure; button re-enabled so the user can retry

If `shouldConfirmClearCart` is false: skip dialog, same clear → POST → reload.

## Semua Stall visibility

```ts
canUseCentralCashier =
  user.has_central_cashier_menu === true &&
  user.can_central_checkout === true;

hideAllStallsOption =
  (pathname.includes("/cashier") || pathname.includes("/restaurant")) &&
  !canUseCentralCashier;
```

Not driven by `can_switch_stall` alone. Amber banner only when `hideAllStallsOption`.

## Layout / flag threading

`StallSwitcher` lives in `AppSidebar`, used by:

- POS layout (`/dashboard/pos/*`) — flags already present
- Dashboard group layout (`cashier-new`, `cashier-fullscreen`, `restaurant-tablet`, `/dashboard/pos/tablet`) — flags added in this commit

Immersive/chrome-less POS still mounts `AppSidebar` (children only). The provider wraps that path too, so `CashierStallGate` can read `canUseCentralCashier` without catalog-chip work (Task 7).

## CashierStallGate

- Central cashier + reason `all` or `all_stalls` → no overlay
- Regular user + `all_stalls` / `multiple_unselected` / `no_stall_assignment` → overlay
- Anyone + `no_stall` → overlay (no assignment)

## Tests

- `pnpm test` (vitest full run via accidental extra `--`): **155 files, 1366 tests, all passed** (includes `central-cashier.test.ts` `shouldConfirmClearCart` and `pos-sell-stall.test.ts`)
- `tsc --noEmit`: no errors in Task 6 files. Repo still has many pre-existing TS errors elsewhere (HRIS, etc.)
- Lint on touched files: existing Tailwind class-style warnings only

## Not in scope

- Task 7 catalog stall chips / phase-1 add-to-cart stall guard
- Changing `resolvePosSellStall` for regular users

## Concerns

None blocking. Notes:

1. Dashboard group layout was not in the brief `git add` list; it is required so cashier-new / tablet paths actually receive the flags.
2. If a central cashier is in mode `all` with an empty catalog, they see an empty product grid instead of the stall overlay (Task 7 chips will sit on that grid).
3. Cart key is cleared **before** POST. A failed POST leaves localStorage empty; user can retry the dialog/button.
