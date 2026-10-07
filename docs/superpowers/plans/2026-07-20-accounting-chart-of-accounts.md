# Accounting Chart of Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Accounting master data — Account Types + hierarchical Chart of Accounts with SULU seed and Excel import.

**Architecture:** New Postgres schema `accounting`; company-scoped CoA tree with derived `is_postable`; feature modules under `src/features/accounting/` mirroring departments (flat) and menus (tree).

**Tech Stack:** Next.js App Router, Postgres via `createServerPgClient`, React Query, `xlsx`, IAM menus delta.

## Global Constraints

- Soft borders / DialogPanel / toast + loading on mutations (UI interaction standards)
- Company scope via `getApiUserScope` / `companyScopeOr` / `effectiveCompanyId`
- Account code stored compact (`1101001`); normalize on input
- `is_postable` server-derived from leaf status; never trust client

---

### Task 1: Schema plumbing + migration + menus

**Files:**
- Modify: `database/schema-map.js`, `src/lib/db.ts`
- Create: `database/migrations/deltas/20260720120000_accounting_chart_of_accounts.sql`

- [ ] Add `accounting` domain to schema-map + SEARCH_PATH
- [ ] Migration: schema, `account_types`, `chart_of_accounts`, indexes, seed types, IAM menus + permissions
- [ ] Apply migration

### Task 2: Shared lib (code normalize, tree, spreadsheet)

**Files:**
- Create: `src/lib/accounting/account-code.ts`, `coa-tree.ts`, `coa-spreadsheet.ts`, `coa-types.ts`

- [ ] Normalize / infer level / ideal parent / resolve parent
- [ ] Tree build/flatten helpers
- [ ] Parse standard + SULU Excel layouts; cash-flow / type heuristics

### Task 3: Account Types API + UI

**Files:**
- Create: `src/app/api/accounting/account-types/route.ts`, `[id]/route.ts`
- Create: `src/features/accounting/account-types/**`
- Create: `src/app/dashboard/(dashboard)/accounting/account-types/page.tsx`

- [ ] CRUD API (block delete if CoA references)
- [ ] List page with DialogPanel form

### Task 4: Chart of Accounts API + UI

**Files:**
- Create: `src/app/api/accounting/chart-of-accounts/route.ts`, `[id]/route.ts`, `import/route.ts`
- Create: `src/features/accounting/chart-of-accounts/**`
- Create: `src/app/dashboard/(dashboard)/accounting/chart-of-accounts/page.tsx`

- [ ] List/create/update/soft-delete with postable recompute
- [ ] Tree table UI + filters + form
- [ ] Import preview/commit

### Task 5: SULU seeder

**Files:**
- Create: `database/seeders/accounting-sulu-coa.js`
- Modify: `package.json` (script)

- [ ] Parse Excel, upsert types already seeded, insert CoA as global template (or `--company=CODE`)
- [ ] Fix Rounding Gain duplicate → `8201003`
