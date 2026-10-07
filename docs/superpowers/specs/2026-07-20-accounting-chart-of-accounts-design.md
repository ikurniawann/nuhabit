# Accounting — Chart of Accounts Design

Date: 2026-07-20  
Source: `docs/data/SULU - COA .xlsx` (sheet `COA`)

## Goal

Fase 1 Accounting master data: **Account Types** + hierarchical **Chart of Accounts**, company-scoped, seeded/imported from SULU COA Excel.

## Decisions

| Topic | Choice |
|---|---|
| Scope | CoA + Account Type lookup (groups stay as parent CoA rows) |
| Multi-tenant | Per company (`company_id`; NULL = global template) |
| Account code | Compact `1101001` (normalize from `1 1 01 001`) |
| Data load | Seeder + UI Excel import |
| Posting | Only leaf accounts (`is_postable` derived) |
| Extra fields | `is_contra`, `cash_flow_category` |

## Data model

Schema: `accounting`

### `account_types` (global)

- `code` UNIQUE: `ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `COGS`, `EXPENSE`, `OTHER_INCOME`, `OTHER_EXPENSE`
- `name`, `normal_balance` (`DEBIT`|`CREDIT`), `sort_order`, `is_active`, audit

### `chart_of_accounts` (company-scoped)

- `company_id` (NULL = global template)
- `code` compact, unique per company where not deleted
- `name`, `parent_id`, `account_type_id`, `level` (1–4)
- `is_postable` (true iff no active children)
- `is_contra` (reverses effective normal balance)
- `cash_flow_category`: `OPERATING` | `INVESTING` | `FINANCING` | `NON_CASH` | NULL
- `description`, `is_active`, soft delete, audit

## Code & hierarchy

Excel format `A B CC DDD` → compact `A`+`B`+`CC`+`DDD` (7 chars).

| Pattern | Level | Example |
|---|---|---|
| `X000000` | 1 | `1000000` CURRENT ASSETS |
| `XY00000` | 2 | `1100000` CASH, BANK & OTHER |
| `XYZZ000` | 3 | `1101000` CASH |
| `XYZZNNN` | 4 | `1101001` Petty Cash |

Parent = ideal parent code if present in set; else nearest ancestor. Skip rows without name. Fix known Excel duplicate: Rounding Gain `8301001` → `8201003`.

## Digit → account type (seed)

| Digit | Type | Notes |
|---|---|---|
| 1 | ASSET | |
| 2 | LIABILITY | |
| 3 | EQUITY | |
| 4 | REVENUE | |
| 5 | COGS | |
| 6–7 | EXPENSE | |
| 8 + subgroup 2 | OTHER_INCOME | Non-op income |
| 8 otherwise | OTHER_EXPENSE | Depreciation, non-op expense |

Cash flow heuristics on seed: cash/bank/AR/AP → OPERATING; fixed assets → INVESTING; equity/loans → FINANCING; depreciation → NON_CASH; headers → NULL.

## API / UI

- `/dashboard/accounting/account-types`
- `/dashboard/accounting/chart-of-accounts`
- `/api/accounting/account-types`, `/api/accounting/chart-of-accounts` (+ `[id]`, `/import`)
- Roles: `super_admin`, `admin`, `finance_staff`
- CoA UI: tree table (menus pattern); Account Types: flat list (departments pattern)
- Import: standard columns or SULU layout; preview then commit

## Out of scope

Journal entries, trial balance, multi-currency, cost centers, Accumulated Depreciation accounts (not in source Excel — `is_contra` still available for manual use).
