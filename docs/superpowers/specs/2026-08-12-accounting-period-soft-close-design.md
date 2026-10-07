# Accounting Period Soft Close — Design

**Date:** 2026-08-12  
**Scope:** Soft close only (no closing journals / year-end P&L)

## Goal
Operational UI for OPEN/CLOSED fiscal periods under Period & Closing menus.

## Pages
1. **Accounting Period** `/dashboard/accounting/period/accounting-period`  
   List periods (filter FY + status), show JE draft/posted counts, Open / Close actions.
2. **Period Closing** `/dashboard/accounting/period/closing`  
   Wizard: pick OPEN period → preflight (block if DRAFT JE) → confirm → set CLOSED.

## Rules
- Reuse existing `openFiscalPeriodById` (auto-close previous OPEN when opening next).
- Close blocks if any non-deleted DRAFT journal entries exist in that period.
- No closing journal, no Beginning Balance changes.
- Fiscal Years remains the place to create/edit year + period calendar.

## API
- `GET /api/accounting/fiscal-periods` — list with counts
- `POST /api/accounting/fiscal-periods/[id]/close` — soft close
- Reuse `POST /api/accounting/fiscal-periods/[id]/open`
