# POS Manual Discount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kasir dapat memberi diskon manual item + transaksi (% atau Rp), ditumpuk dengan membership & promo, dengan persist type/value/amount.

**Architecture:** Pure helpers di `src/lib/pos/manual-discount.ts` dipakai cart UI + server. Migrasi menambah kolom type/value. Cart localStorage menyimpan input; create-order menghitung ulang dan menolak mismatch.

**Tech Stack:** Next.js, PostgreSQL deltas, React cart hooks, DialogPanel, Vitest/Jest unit tests.

**Spec:** `docs/superpowers/specs/2026-08-13-pos-manual-discount-design.md`

## Global Constraints

- Stack: item → membership → promo → manual transaksi → tax/charges
- No approval gate
- Cap ≤ basis; percent 0–100; tolerance Rp 1
- Soft UI borders; DialogPanel; loading + toast on apply

## File map

| File | Role |
|------|------|
| `src/lib/pos/manual-discount.ts` | Pure compute + reason builder |
| `src/lib/pos/manual-discount.test.ts` | Unit tests |
| `database/migrations/deltas/20260813090000_pos_manual_discount.sql` | Columns |
| `src/hooks/use-pos-cart.ts` | Cart fields + actions |
| `src/components/pos/ManualDiscountDialog.tsx` | Shared dialog |
| `src/components/pos/CartPanel.tsx` | Item badge + tx control + breakdown |
| `src/hooks/use-pos-checkout.ts` + cashier | Payload wiring |
| `src/lib/pos-api.ts` | Types |
| `src/app/api/pos/orders/route.ts` (+ open-bill) | Persist + validate |

---

### Task 1: Pure helpers + tests

- [x] Write `manual-discount.test.ts` (line %, fixed, cap, order stack, reason)
- [x] Implement `manual-discount.ts`
- [x] Run tests until green

### Task 2: Migration

- [x] Add delta SQL for item + order columns

### Task 3: Cart state

- [x] Extend `PosCartItem` + cart order manual fields + SET_ITEM_DISCOUNT / SET_MANUAL_DISCOUNT actions
- [x] Derive line totals / item discount sum via helpers

### Task 4: UI

- [x] `ManualDiscountDialog` (DialogPanel, %|Rp, apply/clear, loading)
- [x] Wire CartPanel item + transaction + breakdown rows

### Task 5: API + checkout

- [x] Types + checkout payload
- [x] Server recompute + insert columns; mismatch 400
- [x] open-bill parity if writes discount

### Task 6: Verify

- [x] Unit tests pass
- [x] Migration applied
