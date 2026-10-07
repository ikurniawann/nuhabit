# Accounting AP Native (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship native Accounts Payable in Accounting — `ap_invoices` / `ap_payments` as source of truth, UI under Accounting AP menus, Journal Mapping for posting, deprecate Purchasing pay UI.

**Architecture:** New `accounting.ap_*` tables. GRN completion creates/posts an AP invoice and posts `PURCHASE_AP_INVOICE` with `source_document_type=ap_invoice`. Payments are created only via Accounting AP Payment API (posts `PURCHASE_PAYMENT`), and dual-write `purchasing.vendor_payments` so existing PO outstanding views stay consistent during transition. Purchasing pay endpoints/UI redirect or refuse.

**Tech Stack:** Next.js App Router, Postgres deltas, `src/lib/accounting/*-store.ts`, feature modules under `src/features/accounting/ap/`, Vitest for pure helpers, React Query + toast/loading UI standards.

**Spec:** `docs/superpowers/specs/2026-08-12-accounting-ap-ar-menu-design.md` (build order 1–3). AR (order 4–5) is out of this plan.

## Global Constraints

- Soft borders / DialogPanel / toast + loading on mutations (UI interaction standards)
- Company scope via existing API auth helpers (`requireApiRole`, company scope patterns used by accounting)
- Journal posting only via `postJournalFromMapping` — no hard-coded COA
- Do not edit already-applied migration deltas; add a new delta
- IAM menu codes for AP already exist — prefer implementing pages over new menu rows

## File map

| Path | Responsibility |
|---|---|
| `database/migrations/deltas/20260812120000_accounting_ap_documents.sql` | `ap_invoices`, `ap_payments`, `ap_payment_allocations` |
| `src/lib/accounting/ap-types.ts` | Status unions, DTO shapes |
| `src/lib/accounting/ap-status.ts` | Outstanding + payment status + aging buckets (pure) |
| `src/lib/accounting/ap-status.test.ts` | Unit tests |
| `src/lib/accounting/ap-store.ts` | CRUD/list + create-from-GRN + record payment |
| `src/lib/accounting/ap-posting.ts` | Thin wrappers: post AP invoice / payment JE |
| `src/lib/purchasing/accounting-posting.ts` | GRN path: create AP invoice then post JE against it; stop AP JE keyed by `grn` |
| `src/app/api/accounting/ap/invoices/route.ts` | List (+ optional create manual) |
| `src/app/api/accounting/ap/invoices/[id]/route.ts` | Get |
| `src/app/api/accounting/ap/payments/route.ts` | List + create payment |
| `src/app/api/accounting/ap/payable/route.ts` | Register aggregate |
| `src/app/api/accounting/ap/aging/route.ts` | Aging report |
| `src/features/accounting/ap/**` | Pages, api client, queries, mutations |
| Dashboard AP pages | Wire feature pages instead of Coming Soon / purchasing wrap |
| Purchasing pay route + vendor-payments UI | Deprecate |

---

### Task 1: Schema migration

**Files:**
- Create: `database/migrations/deltas/20260812120000_accounting_ap_documents.sql`

- [ ] **Step 1: Create tables**

```sql
-- accounting.ap_invoices
-- id, company_id, invoice_no, invoice_date, due_date,
-- vendor_id (purchasing.vendors, nullable), supplier_id (purchasing.suppliers, nullable),
-- purchase_order_id, grn_id (unique where not null — one AP invoice per GRN),
-- currency default IDR, subtotal, tax_amount, total_amount,
-- status DRAFT|POSTED|VOID, posted_at, posted_by,
-- description, soft delete + audit

-- accounting.ap_payments
-- id, company_id, payment_no, payment_date, amount, method,
-- reference_number, notes, status DRAFT|POSTED|VOID,
-- vendor_payment_id (nullable FK purchasing.vendor_payments for dual-write),
-- soft delete + audit

-- accounting.ap_payment_allocations
-- id, payment_id, invoice_id, amount
-- unique (payment_id, invoice_id)
```

Indexes: company+status, po_id, vendor/supplier, due_date; unique invoice_no / payment_no per company (soft-delete aware).

- [ ] **Step 2: Apply migration** (`npm run db:migrate` or project equivalent against local DB)

---

### Task 2: Pure status helpers + tests

**Files:**
- Create: `src/lib/accounting/ap-types.ts`, `ap-status.ts`, `ap-status.test.ts`

- [ ] **Step 1: Failing tests** for:
  - `computeInvoiceOutstanding(total, allocated) → max(0, round2)`
  - `resolvePaymentStatus({ total, allocated, dueDate, today }) → unpaid|partial|paid|overdue`
  - `bucketAging(outstanding, dueDate, asOf) → current|1_30|31_60|61_90|90_plus`

- [ ] **Step 2: Implement helpers; run** `pnpm exec vitest run src/lib/accounting/ap-status.test.ts`

---

### Task 3: Store + posting

**Files:**
- Create: `src/lib/accounting/ap-store.ts`, `ap-posting.ts`
- Modify: `src/lib/purchasing/accounting-posting.ts` (`postGrnAccountingJournals`)

**Interfaces:**
- `createApInvoiceFromGrn({ db, grnId, userId }) → ApInvoiceRow` (idempotent on `grn_id`)
- `postApInvoiceJournal({ companyId, userId, invoice }) → MappingPostResult`
- `recordApPayment({ ... }) → { payment, vendorPaymentId, journal }`
  - inserts `ap_payments` + allocations
  - dual-writes `vendor_payments` + recalculates payment term (reuse `po-payments` helpers)
  - posts `PURCHASE_PAYMENT` with `documentType: "ap_payment"`, `documentId: payment.id`

- [ ] **Step 1: Implement store create-from-GRN** using `buildGrnAccountingAmounts` for amounts; invoice_no like `AP-YYYYMMDD-####`
- [ ] **Step 2: Change `postGrnAccountingJournals`** to:
  1. post `PURCHASE_GRN` (documentType `grn`) as today
  2. `createApInvoiceFromGrn` → status POSTED
  3. post `PURCHASE_AP_INVOICE` with `documentType: "ap_invoice"`, `documentId: invoice.id` (not `grn`)
- [ ] **Step 3: Implement `recordApPayment`** with dual-write + journal

---

### Task 4: AP APIs

**Files:**
- Create routes under `src/app/api/accounting/ap/...`
- Roles: `admin`, `super_admin`, `finance_staff` (align with other accounting APIs; include `purchasing_admin` read-only on list if needed)

- [ ] **Step 1:** `GET/POST /api/accounting/ap/invoices`
- [ ] **Step 2:** `GET /api/accounting/ap/invoices/[id]`
- [ ] **Step 3:** `GET/POST /api/accounting/ap/payments` (POST = record payment)
- [ ] **Step 4:** `GET /api/accounting/ap/payable` (register rows with outstanding)
- [ ] **Step 5:** `GET /api/accounting/ap/aging`

---

### Task 5: Accounting AP UI

**Files:**
- Create: `src/features/accounting/ap/**` (types, api, query-keys, queries, mutations, components)
- Modify dashboard pages:
  - `accounts-payable/page.tsx` → Payable register (stop `PurchaseInvoicesPage` wrap)
  - `accounts-payable/invoices/page.tsx` → invoice list
  - `accounts-payable/payments/page.tsx` → payment list + pay dialog
  - `accounts-payable/aging/page.tsx` → aging table

UI reference: Purchasing PR list / vendor-payments table patterns; soft borders; pay mutation toast + loading.

- [ ] **Step 1:** Feature module + invoice list page
- [ ] **Step 2:** Payments page + DialogPanel pay form (select open invoice, amount, method, date)
- [ ] **Step 3:** Payable register page
- [ ] **Step 4:** Aging page

---

### Task 6: Deprecate Purchasing pay UI

**Files:**
- Modify: `src/app/api/purchasing/po/[id]/payments/route.ts` — POST returns `410` / clear message: bayar via Accounting AP Payment
- Modify: `src/features/purchasing/vendor-payments/components/purchase-invoice-pay-dialog.tsx` + list actions — CTA link to `/dashboard/accounting/accounts-payable/payments?invoice=` or payable
- Modify: purchasing vendor-payments pages — remove primary pay button or replace with deep-link

- [ ] **Step 1:** Block POST payments API
- [ ] **Step 2:** Replace pay dialog with redirect/CTA
- [ ] **Step 3:** Smoke: GRN → AP invoice appears; pay from Accounting; Purchasing pay blocked

---

### Task 7: Verify

- [ ] `pnpm exec vitest run src/lib/accounting/ap-status.test.ts`
- [ ] `pnpm exec tsc --noEmit` (or project check) on touched paths
- [ ] Manual: migrate applied; create GRN on local → invoice in AP; pay in Accounting; purchasing pay returns error

---

## Out of this plan

- AR Receipt / Receivable / Invoice non-B2B (spec build order 4–5)
- Full drop of `vendor_payments` dual-write (later cleanup)
- Subsidiary Ledger page
- Changing POS mappings
