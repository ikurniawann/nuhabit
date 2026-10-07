# Accounting — AP/AR Menu & Ownership Design

Date: 2026-08-12  
Status: Approved (discussion) — pending implementation plan

## Goal

Menetapkan peran menu **Accounts Payable (AP)** dan **Accounts Receivable (AR)** di Accounting sebagai **modul kerja penuh** (native source of truth), dengan **Journal Mapping** tetap sebagai konfigurasi posting di Master Data — bukan pengganti menu AP/AR.

## Decisions

| Topic | Choice |
|---|---|
| Peran AP/AR | Modul kerja penuh: invoice, payment/receipt, register, aging |
| Source of truth | Native Accounting (dokumen + status outstanding di AP/AR) |
| Journal Mapping | Config event → COA di Master Data saja |
| Purchasing pay UI | Deprecate — bayar hanya di Accounting AP Payment |
| Sales / Funnel | Kirim dokumen sumber; close piutang / receipt utama di AR |
| Menu tree | Pertahankan group IAM yang ada; ubah makna & implementasi halaman |
| Subsidiary Ledger | Tetap di General Ledger (buku pembantu teknis); AP/AR = view bisnis |

## Current state (baseline)

Sidebar Accounting sudah punya group AR/AP (lihat `database/seeders/iam-menus.sql`).

| Area | Reality today |
|---|---|
| Journal Mapping | Live di Master; modules POS / PURCHASING / PAYROLL / PINJAMAN |
| Posting AP | Dipicu dari Purchasing (`src/lib/purchasing/accounting-posting.ts`: `PURCHASE_GRN`, `PURCHASE_AP_INVOICE`, `PURCHASE_PAYMENT`) |
| AP Payable page | Reuse `PurchaseInvoicesPage` (purchasing vendor-payments) |
| AP Invoice / Payment / Aging | Coming Soon |
| AR Invoice B2B | Live via `FinanceInvoicesPage` (sales funnel) |
| AR Receivable / Invoice / Receipt / Aging | Coming Soon / stub |

## Module boundaries

| Module | Owns | Does not own |
|---|---|---|
| Purchasing | PO, GRN, returns; handoff dokumen ke AP; read-only status + deep-link | Create/pay AP invoice; close payable |
| Sales / Funnel | Deal B2B; handoff dokumen ke AR | Primary AR receipt / close receivable |
| Master → Journal Mapping | Rules: event → debit/credit COA | Daily AP/AR operations |
| **Accounts Payable** | AP Invoice, AP Payment, Payable register, Aging | Mapping setup |
| **Accounts Receivable** | AR Invoice (B2B + non-B2B), Receipt, Receivable register, Aging | Mapping setup |
| General Ledger | Posted JE, GL, trial balance, subsidiary drill-down | Party register / aging UX |

## Menu tree (IA)

Tidak perlu group menu baru. Kode IAM hierarkis tetap:

```
Accounting
├── Dashboard
├── Master Data
│   ├── Chart of Accounts
│   ├── Account Types
│   └── Journal Mapping          ← setup posting only
├── General Ledger
│   ├── Journal Entries
│   ├── Journal History
│   ├── General Ledger
│   ├── Subsidiary Ledger        ← technical subledger, not AP/AR replacement
│   └── Trial Balance
├── Cash & Bank
├── Accounts Receivable          ← working module
│   ├── Receivable               register outstanding per customer
│   ├── Invoice B2B              owner of B2B AR status
│   ├── Invoice                  non-B2B / manual AR
│   ├── Receipt                  collect receivable + post JE
│   └── Aging
├── Accounts Payable             ← working module
│   ├── Payable                  register outstanding per vendor
│   ├── Invoice                  AP invoice / match to PO–GRN + post JE
│   ├── Payment                  sole payment entry + post JE
│   └── Aging
├── Period & Closing
└── Reports
```

### Leaf semantics

**Accounts Payable**

| Leaf | Role |
|---|---|
| Payable | Register outstanding per vendor (replace purchasing-list wrap) |
| Invoice | Create/confirm/match AP invoice; link PO/GRN; post via mapping |
| Payment | Record vendor payment; **only** payment door; post via mapping |
| Aging | Overdue buckets from AP register |

**Accounts Receivable**

| Leaf | Role |
|---|---|
| Receivable | Register outstanding per customer |
| Invoice B2B | Manage funnel invoices; own AR open/paid status |
| Invoice | Non-B2B / manual customer invoices |
| Receipt | Receive payment against AR; post via mapping |
| Aging | Overdue buckets from AR register |

## Data ownership

Native SoT means **AP/AR documents and balances live under Accounting** (schema `accounting` or accounting-owned tables), not as side effects of Purchasing payment rows.

| Record | Owner | Link to operations |
|---|---|---|
| AP Invoice | Accounting | `source` → PO and/or GRN id(s); vendor party |
| AP Payment | Accounting | allocates to AP Invoice id(s); cash/bank account |
| AP outstanding / aging | Derived from AP Invoice − allocations | — |
| AR Invoice (B2B / other) | Accounting | `source` → funnel/deal or manual; customer party |
| AR Receipt | Accounting | allocates to AR Invoice id(s) |
| AR outstanding / aging | Derived from AR Invoice − receipts | — |

Migration stance: existing Purchasing vendor-payment / PO payable views may seed or backfill AP records once, then stop being the write path. Do not keep Purchasing payment tables as dual SoT after cutover.

Invoice B2B today (`FinanceInvoicesPage`) must converge to the same pattern: Accounting owns open/paid/outstanding; funnel remains document source.

Exact table DDL is deferred to the implementation plan; this spec locks **ownership and links**, not column lists.

## Data flow (target)

```
Purchasing (PO / GRN)
  └── source document ──► AP Invoice (Accounting)
                            ├── post JE: PURCHASE_AP_INVOICE (journal mapping)
                            └── outstanding on Payable register

Sales funnel (B2B deal)
  └── source document ──► AR Invoice B2B (Accounting)
                            ├── post JE: AR mapping event (add codes if missing)
                            └── outstanding on Receivable register

AP Payment (Accounting) ──► post JE: PURCHASE_PAYMENT ──► reduce outstanding
AR Receipt (Accounting) ──► post JE: AR receipt mapping event ──► reduce outstanding
```

### Posting rules

- Confirm **AP Invoice** → `postJournalFromMapping` with `PURCHASE_AP_INVOICE`.
- Confirm **AP Payment** → `PURCHASE_PAYMENT`.
- **GRN** may still post `PURCHASE_GRN` from Purchasing (inventory / GRNI); that does **not** replace AP Invoice ownership.
- AR invoice/receipt: add Journal Mapping module/event codes if none exist yet (e.g. under a future `SALES`/`AR` module); do not hard-code COA in AR UI.
- Journal Mapping UI stays under Master; AP/AR pages show linked posted JE, not mapping editors.

## Purchasing UI migration

| Surface | Target behavior |
|---|---|
| `/dashboard/.../purchasing/vendor-payments` (and pay dialogs) | Deprecate: redirect or CTA “Bayar di Accounting” → AP Payment |
| PO / GRN detail | Show AP status from Accounting; deep-link to AP Invoice / Payment |
| Accounting AP Payable | Native register — stop reusing `PurchaseInvoicesPage` as the long-term UI |

Dual payment UIs are out of scope after cutover. No long-lived “shortcut form in Purchasing that writes AP” — source of truth is Accounting only.

## Build order

1. **AP Invoice + AP Payment** native + move posting triggers from Purchasing pay path to AP actions  
2. **Payable register + Aging** from AP data  
3. **Deprecate** Purchasing vendor-payments pay UI (redirect / CTA)  
4. **AR Receipt + Receivable register + Aging**  
5. Strengthen **Invoice B2B** as AR status owner; add **Invoice** non-B2B  

Menu codes/routes already exist for most leaves; prefer implementing pages over new IAM rows unless labels/order must change.

## Out of scope

- Redesign of Cash & Bank, Period Closing, or financial statement reports  
- Multi-currency AP/AR  
- Replacing Journal Mapping with hard-coded COA in AP/AR forms  
- Full Subsidiary Ledger implementation (separate from this ownership design)  
- Changing POS sale mapping (cash/wallet sales remain POS events; not AP)

## Success criteria

- Accountant can create/confirm AP invoice and record payment entirely under Accounting → AP  
- Outstanding and aging reflect AP/AR registers, not Purchasing payment tables as SoT  
- Purchasing no longer offers a primary pay flow after deprecate step  
- Posted journals still come from Journal Mapping (no duplicate posting engines)  
- AR B2B invoice status is owned in Accounting AR, with funnel as document source  
