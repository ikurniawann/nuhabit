# POS Restaurant Pre Settlement Preview Bill — Implementation Plan

> **For agentic workers:** Execute task-by-task. Spec: `docs/superpowers/specs/2026-07-12-pos-restaurant-pre-settlement-preview-bill-design.md`

**Goal:** Pre Settlement marks billing + prints preview bill; stay on restaurant (no cashier `pay=1`).

**Tech:** Existing `printThermalReceipt`, `preSettleOrder`, action rail, `selectedOrder`.

## File map

| File | Change |
|------|--------|
| `src/components/pos/PrintReceipt.tsx` | Support `PREVIEW_BILL` label; omit pay/change lines |
| `src/features/pos/restaurant/order-to-receipt.ts` (+ test) | Map open bill `Order` → `ReceiptPayload` |
| `src/features/pos/restaurant/components/restaurant-action-rail.tsx` | Remove cashier navigate; print preview after pre-settle |
| Parent specs (optional note) | Billing-colors spec still valid; handoff `pay=1` no longer from Pre Settlement |

---

### Task 1: Print helper + order mapper

**Files:**
- Modify `src/components/pos/PrintReceipt.tsx`
- Create `src/features/pos/restaurant/order-to-receipt.ts`
- Create `src/features/pos/restaurant/order-to-receipt.test.ts`

- [ ] Extend label union with `PREVIEW_BILL`
- [ ] For `PREVIEW_BILL`: title PREVIEW BILL; show totals; skip Bayar/Kembalian
- [ ] Mapper: order items → cart-like items; table display name; totals from order fields
- [ ] Unit test mapper with fixture order

### Task 2: Wire action rail

**Files:**
- Modify `src/features/pos/restaurant/components/restaurant-action-rail.tsx`

- [ ] After successful pre-settle + invalidate tables: build payload via mapper; `printThermalReceipt(..., "PREVIEW_BILL")`
- [ ] Remove `router.push(buildCashierHandoffUrl({ ..., pay: true }))`
- [ ] If `selectedOrder` missing items, toast and still keep billing status (print skipped or toast only)

### Task 3: Verify

- [ ] `npm test -- src/features/pos/restaurant/order-to-receipt.test.ts`
- [ ] Manual: select occupied → Pre Settlement → stay on board, red table, preview print popup
