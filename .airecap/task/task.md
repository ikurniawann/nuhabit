# Task: POS Kasir Pusat multi-stall

## Goal
Kasir pusat jual semua stall, bayar 1x; data pecah per stall. Kasir stall tetap transaksi sendiri.

## Spec
`docs/superpowers/specs/2026-08-15-pos-central-cashier-multi-stall-design.md`

## Plan
`docs/superpowers/plans/2026-08-15-pos-central-cashier-multi-stall.md`

- [x] User review spec (lanjut ke plan)
- [x] Tulis implementation plan
- [x] Fase 1: IAM + flag + katalog + filter + dialog switch (Task 1–7)
- [x] Fase 2: checkout + child + payment 1x (Task 8–11)
- [x] Fase 3: restaurant multi-bill (Task 12)
- [x] Fase 4: KDS + antrian (Task 13)
- [x] Fase 5: laporan + webhook Xendit (Task 14–15)
- [x] Final-review fixes: block mixed promo, cancel orphan QRIS, hide IAM menu on seed

## Follow-up: filter Orders
- [x] Periode `date_from`/`date_to` (WIB) di GET `/api/pos/orders`
- [x] Filter pembayaran, tipe, metode + chip Void
- [x] Default hari ini; preset 7 hari / bulan ini

## Review
Branch `feature/pos-central-cashier`. Tes unit 1452 passed sebelum fix terakhir; fix commit `a9e4ea5a`.

Follow-up laporan transaksi: dialog Detail dipecah Transaksi / Pembayaran / Xendit (QRIS) / Item terjual. Settlement Pending dijelaskan sebagai cair T+2, bukan gagal bayar.

Follow-up metode bayar custom: persist `payment_method_code` + `payment_method_name` di order/checkout supaya laporan, struk, dan laci shift tidak jatuh ke label Tunai/Kartu. Alias custom tidak dihitung sebagai uang laci.

## Follow-up: Laporan Void
- [x] API `GET /api/pos/reports/voids` (status voided, item, alasan, kasir, supervisor)
- [x] Halaman `/dashboard/pos/reports/voids` + menu IAM Void
- [x] Detail reuse `TransactionDetailBody` (kartu Void + item)
- [x] Migrasi menu diterapkan lokal (`20260816183000_pos_void_report_menu.sql`)
- [x] Grant diperluas + label sidebar **Laporan Void** (`20260816184500_pos_void_report_menu_grants.sql`)
