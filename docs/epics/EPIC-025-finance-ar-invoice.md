# EPIC-025: Finance — Invoice & Pembayaran (AR)

status: ready-for-qa
environment: dev
retries: 0

## Goal

Memindahkan penerbitan invoice dan pencatatan pembayaran dari pipeline sales
ke modul Finance baru (keputusan owner 2026-07-23, **Opsi B** — paling ketat):

- **Sales** hanya MENGAJUKAN permintaan invoice dari termin quotation dan
  melihat status (dokumen + pelunasan) di popup deal. Tidak bisa menerbitkan,
  membatalkan, atau mencatat pembayaran.
- **Finance** (`finance_staff` + super_admin) menerbitkan/mengirim invoice,
  membatalkan, dan mencatat/koreksi pembayaran lewat modul
  `/dashboard/finance/invoices` lintas-deal.
- Pipeline mendapatkan status pelunasan (belum/sebagian/lunas) dari Finance —
  separation of duties AR yang standar.

## Evidence

- EPIC-022 Fase G/H: `crm_sales_invoices` + `crm_sales_deal_payments` sudah
  terpisah dari deal; API deal-scoped sudah ada — tinggal geser guard + UI.
- Role `finance_staff` sudah ada di iam.roles (dipakai payroll EPIC-008).
- Pola modul route-aware: ROLE_MODULE_PATHS (EPIC-022) + menu migration
  fase A sales-funnel.

## Scope

1. Status invoice baru `diajukan` (pengajuan sales) → finance `terkirim`
   (terbit+kirim) atau `batal` (tolak). `draft` tersisa untuk invoice lama.
2. Modul Finance: menu `finance` > `finance.invoices`, halaman daftar invoice
   lintas-deal ber-filter + aksi finance + catat pembayaran per invoice.
3. Guard API: payments POST/DELETE & invoice PATCH → finance-only; sales
   POST invoice dipaksa status `diajukan`; sales DELETE hanya pengajuannya
   sendiri yang belum diproses.
4. Pipeline popup: seksi Invoice = ajukan + status + PDF; seksi Pembayaran =
   read-only (progress + riwayat).
5. `finance_staff` masuk ROLE_MODULE_PATHS `/dashboard/finance` (ESS-only
   untuk modul lain).

## Non-Goals (fase lanjut)

- Ledger penerimaan terpadu (POS + ticketing + AR sales) & rekonsiliasi bank.
- Aging report AR + pengingat jatuh tempo WA.
- Nomor invoice per-venue / format pajak resmi (e-Faktur).

## Acceptance Criteria

- [ ] Sales tidak bisa PATCH status invoice / POST payment (403).
- [ ] Pengajuan sales tampil di Finance dengan status `diajukan`; finance bisa
      terbitkan (terkirim) / tolak (batal).
- [ ] Pembayaran hanya tercatat via Finance; pipeline menampilkan status
      pelunasan yang sama (sumber data tunggal).
- [ ] finance_staff hanya bisa membuka `/dashboard/finance/*` (ESS untuk
      sisanya); sales tidak bisa membuka `/dashboard/finance`.
- [ ] Tenant isolation fail-closed di semua endpoint finance.

## Test Plan

- Typecheck + build hijau; smoke test role sales vs finance_staff di dev.
- Uji transisi: diajukan→terkirim→(bayar sebagian→lunas); batal ditolak bila
  sudah ada pembayaran.

## Automation Log

- 2026-07-23: Epic dibuat dari keputusan owner (Opsi B dipilih atas Opsi A
  "sales tetap menerbitkan"). Implementasi dimulai di sesi yang sama.
- 2026-07-23: Implementasi selesai, live dev, ready-for-qa:
  - Migrasi `20260723190000_finance_ar_module.sql`: status `diajukan` +
    menu `finance`/`finance.invoices` (grant super_admin + finance_staff);
    seeder iam-menus.sql whitelist ditambah (anti insiden retire 19 Jul).
  - `src/lib/finance/server.ts`: requireFinanceRole(allowed?) —
    FINANCE_ROLES [super_admin, finance_staff], INVOICE_VIEWER_ROLES (+sales).
  - Guard digeser: invoice PATCH & payments POST/DELETE → finance-only;
    POST invoice (deal-scoped) selalu status `diajukan`; sales DELETE hanya
    pengajuan `diajukan` miliknya. GET payments/invoices tetap viewer roles.
  - Route finance baru: GET /api/finance/invoices (lintas-deal, scope
    fail-closed, filter status+q, diajukan tampil dulu), GET+POST
    /api/finance/invoices/[id]/payments (tolak bayar bila `diajukan`/
    `batal`), DELETE /api/finance/payments/[paymentId].
  - UI: /dashboard/finance/invoices (FinanceInvoicesPage — terbitkan/tolak/
    hapus/PDF/catat bayar+riwayat); pipeline InvoiceSection = "Ajukan
    Invoice" + tarik pengajuan; PaymentSection read-only.
  - ROLE_MODULE_PATHS += finance_staff → /dashboard/finance.
  - Verifikasi: typecheck bersih, build OK, /api/finance/invoices tanpa
    auth = 401. Sisa QA manusia: akun uji finance_staff ber-scope company
    (fail-closed menolak tanpa scope), alur diajukan→terbitkan→bayar→lunas.
- 2026-07-23 (lanjutan): permintaan owner — Finance perlu lihat detail
  invoice (jelas refer ke quotation/termin yang mana) + bisa merevisi.
  - GET/PATCH /api/finance/invoices/[id]: detail gabung quotation+termin+
    deal+lead+paid; PATCH revisi (label/nominal/jatuh tempo/catatan) DITOLAK
    bila status batal atau sudah ada pembayaran (409) — nominal tak boleh
    menyimpang dari uang yang sudah masuk.
  - UI: klik nomor invoice di daftar Finance → InvoiceDetailDialog (blok
    "Mengacu ke Quotation" tampilkan quote_number+status+PPN+termin+jatuh
    tempo asal; toggle mode Revisi in-place, bukan popup terpisah).
  - Verifikasi: query GET/PATCH dites langsung ke Postgres (skema cocok),
    guard 401 tanpa auth, typecheck+build hijau.
