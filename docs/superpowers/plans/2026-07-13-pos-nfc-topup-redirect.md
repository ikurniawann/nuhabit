# POS NFC → Topup Redirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tap NFC card on any POS page redirects to topup with member auto-selected, unless payment NFC is active.

**Architecture:** Keyboard-wedge buffer helpers + `PosNfcProvider`/`PosNfcScanListener` on `/dashboard/pos/*` (via AppSidebar). Cashier sets payment claim flag. Topup consumes `?card=`.

**Tech Stack:** Next.js App Router, React, Vitest, sonner toast

## Global Constraints

- Keyboard wedge only (no PC/SC bridge)
- Lookup by customer `id` or `phone` (existing cashier behavior)
- Soft borders / existing POS UI patterns

---

### Task 1: Wedge buffer + path helpers (TDD)

**Files:**
- Create: `src/features/pos/nfc/wedge-buffer.ts`
- Create: `src/features/pos/nfc/wedge-buffer.test.ts`
- Create: `src/features/pos/nfc/resolve-topup-path.ts`
- Create: `src/features/pos/nfc/resolve-topup-path.test.ts`
- Create: `src/features/pos/nfc/find-customer-by-card.ts`
- Create: `src/features/pos/nfc/find-customer-by-card.test.ts`

- [ ] Write failing tests for buffer append/commit/reset and debounce rules
- [ ] Implement helpers
- [ ] Write tests for topup path + customer find
- [ ] Implement path/find helpers

### Task 2: Provider + listener

**Files:**
- Create: `src/features/pos/nfc/pos-nfc-context.tsx`
- Create: `src/features/pos/nfc/pos-nfc-scan-listener.tsx`
- Create: `src/features/pos/nfc/index.ts`
- Modify: `src/components/shared/app-sidebar.tsx`

- [ ] Context with `paymentNfcActive` / `setPaymentNfcActive`
- [ ] Listener: wedge detect → redirect or no-op if payment active / already handling
- [ ] Wrap AppSidebar children when pathname starts with `/dashboard/pos`

### Task 3: Cashier claim + Topup consume

**Files:**
- Modify: `src/features/pos/cashier/components/cashier-page.tsx`
- Modify: `src/features/pos/topup/components/topup-page.tsx`

- [ ] Cashier sets payment flag when Payment/NFC modal open
- [ ] Topup reads `card`, lookup, select, clear param, toast on miss

### Task 4: Verify

- [ ] Run unit tests for nfc helpers
- [ ] Lint touched files
