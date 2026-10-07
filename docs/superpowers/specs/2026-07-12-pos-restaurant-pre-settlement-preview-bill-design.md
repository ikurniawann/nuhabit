# POS Restaurant Pre Settlement → Preview Bill

- **Date:** 2026-07-12
- **Status:** Approved (approach A)
- **Parent:** `docs/superpowers/specs/2026-07-12-pos-restaurant-table-billing-colors-design.md`
- **Scope:** Change Pre Settlement action so it marks billing status and prints a preview bill without opening cashier payment

---

## Problem

Pre Settlement currently:

1. Sets `pre_settled_at`
2. Navigates to cashier with `pay=1`
3. Opens payment → receipt/print popup (paid-style struk)

Desired: mark **Pre Settlement** (meja merah / `billing`) and print a **preview bill**, stay on `/dashboard/pos/restaurant`.

---

## Behavior

When **Pre Settlement** is clicked (occupied/billing table or bill selected with `orderId`):

1. `POST /api/pos/orders/[id]/pre-settle`
2. On success: toast success
3. Invalidate cashier tables query → denah shows `billing` (red)
4. Open **Preview Bill** modal (`DialogPanel`) with order lines + totals (unpaid)
5. Modal actions: **Close** / **Print** — Print calls thermal print (`PREVIEW_BILL`, no Bayar / Kembalian)
6. **Do not** navigate to cashier; **do not** pass `pay=1`

On API failure: toast error; no modal; no navigation.

Payment remains via Order Check, double-click occupied table, or normal cashier flows.

---

## Print helper

Extend `printThermalReceipt` (or a thin wrapper) to support a print kind / label such as `PREVIEW_BILL`:

- Header: `PREVIEW BILL` (or `PRE-SETTLEMENT`)
- Show items + discount + tax + TOTAL
- Omit payment method, amount paid, and change
- Reuse existing window.open + `window.print()` pattern

Map `selectedOrder` → `ReceiptPayload`-compatible shape in the action rail (or a small helper next to restaurant components).

---

## Non-goals

- New DialogPanel preview before print
- Changing color rules for `billing`
- Changing when `pre_settled_at` is cleared (still on new open bill for same table)
- Auto-return-from-cashier for this action (no cashier handoff)

---

## Acceptance

- [ ] Pre Settlement leaves user on restaurant board
- [ ] Selected table turns red (`billing`) after success
- [ ] Preview Bill modal opens with lines + totals (unpaid)
- [ ] Print action opens thermal preview (not paid receipt)
- [ ] No cashier URL with `pay=1` from this action
- [ ] Order Check / pay flows unchanged
