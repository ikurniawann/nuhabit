# EPIC-051: Tagihan Member — Cicilan Order Member (POS → Operasional → Tagihan) — `MODULE-POS`

status: ready-for-qa
environment: dev
phase: 1
priority: P1
area: Fullstack
module: `MODULE-POS`
retries: 0

## Goal

Order member yang belum lunas bisa dibayar bertahap. Kasir memilih member,
melihat semua order belum lunas + sisa tagihan, lalu membayar sebagian
(mis. 500rb dari 1jt) dengan metode bayar POS. Order tetap terbuka sampai
lunas; riwayat order & pembayaran tetap tersimpan.

## Keputusan owner (2026-10-01)

- **Model deposit**: cicilan dicatat di akun member, tidak menunjuk order
  tertentu. Saat saldo cicilan menutup SEMUA order terbuka → semua order
  ditutup sekaligus (`payment_method = 'member_bill'`).
- **Hanya member** (`customer_id`); tamu tetap open bill biasa yang harus
  segera dilunasi.
- **Cakupan**: semua order belum lunas (bukan void/batal/merge), kecuali yang
  sedang split bill.
- **Akuntansi**: uang muka dulu, penjualan saat lunas —
  `POS_MEMBER_DEPOSIT_{CASH,QRIS,CARD}` (Kas/Bank ↔ Uang Muka Member) per
  cicilan; `POS_SALE_MEMBER_BILL` (Uang Muka Member ↔ Penjualan/Pajak/Service)
  per order saat ditutup. Akun COA diisi admin di Accounting → Journal Mapping
  (line role `MEMBER_DEPOSIT`); sebelum diisi, jurnal tercatat draft.

## Tasks

- [x] Migrasi `20261001180000_pos_member_bills.sql` (tabel, kolom, menu, akses role, journal mapping)
- [x] `lib/pos/member-bill.ts` (saldo, validasi nominal, metode, ringkasan shift) + test
- [x] `lib/pos/member-bill-server.ts` — transaksi + advisory lock per member
- [x] API `GET/POST /api/pos/member-bills/...` (+ route test)
- [x] Tutup shift: tunai cicilan masuk kas yang diharapkan
- [x] Halaman `/dashboard/pos/member-bills`
- [ ] Laporan metode bayar menyertakan cicilan (lanjutan)
- [ ] Refund / koreksi cicilan (lanjutan)

## Acceptance Criteria

- Given member dgn order belum lunas 647rb, When kasir bayar 400rb tunai,
  Then sisa 247rb dan order tetap belum lunas.
- Given dua kasir membayar member yang sama bersamaan melebihi sisa, Then hanya
  satu yang berhasil (lainnya "Nominal melebihi sisa tagihan").
- Given sisa 247rb, When dibayar 247rb QRIS, Then semua order → paid
  `member_bill`, settlement tercatat, riwayat bayar & order lunas tetap tampil.
- Kasir (role `pos`) bisa melihat & membayar; tanpa login → 401.

## Automation Log

- 2026-10-01 — Dibangun & diuji E2E pada salinan DB produksi BCD: alur di atas
  lulus (bersamaan 201/400, lebih bayar 400, pelunasan menutup 7 order,
  kasir 201, anon 401). Unit + route test 2380 lulus, tsc baseline 508.
  Deploy poskopi (backup `wwwcoffee-before-member-bills-20261001-1855.dump`).
