# Accounting Period Soft Close Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Soft-close Accounting Period list + Period Closing wizard on existing `fiscal_periods`.

**Architecture:** Extend `src/lib/accounting/fiscal.ts` with list + close; thin API routes; feature module `src/features/accounting/period/` matching cash-bank / AP list UI.

**Tech Stack:** Next.js App Router, React Query, DialogPanel, PostgreSQL `accounting.fiscal_periods` / `journal_entries`.

---

### Task 1: Store close + list periods
**Files:** `src/lib/accounting/fiscal.ts`, optional small pure helper test  
- Add `listAccountingPeriods`, `getPeriodClosePreview`, `closeFiscalPeriodById`  
- Block close when draft JE count > 0

### Task 2: API
**Files:**  
- `src/app/api/accounting/fiscal-periods/route.ts` (GET)  
- `src/app/api/accounting/fiscal-periods/[id]/close/route.ts` (POST)

### Task 3: Feature client
**Files:** `src/features/accounting/period/*`  
- api, query-keys, queries, mutations, types, routes  
- `AccountingPeriodPage`, `PeriodClosingPage`

### Task 4: Wire dashboard pages
Replace Coming Soon on accounting-period + closing pages.

### Task 5: Verify
Typecheck filtered to new files; manual smoke via UI.
