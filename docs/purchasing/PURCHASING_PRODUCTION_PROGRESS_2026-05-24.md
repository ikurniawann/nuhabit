# Purchasing & Production Progress - 2026-05-24

Dokumen ini menyimpan checkpoint terakhir pengembangan Purchasing, Barang Masuk, dan Produksi.

## Status Terakhir

### Barang Masuk

- Menu `Penerimaan` diganti menjadi `Barang Masuk`.
- Flow delivery dan penerimaan barang disatukan dalam satu workspace.
- Status dibedakan dari sisi proses:
  - Menunggu Delivery
  - Dalam Delivery
  - Diterima Sebagian
  - Diterima Penuh
- Istilah `GRN` pada UI utama diganti ke bahasa yang lebih umum:
  - `Input GRN` menjadi `Terima Barang`
  - `Detail GRN` menjadi `Detail Penerimaan`
  - `Belum GRN` menjadi `Belum Diterima`
- Warna tombol action dibedakan:
  - `Terima Barang` memakai pink
  - `Buat Delivery` memakai biru
  - `Detail Penerimaan` memakai hijau
- Error nested button pada halaman penerimaan baru sudah diperbaiki.
- Global hover cursor untuk clickable element sudah ditambahkan agar link, button, menu item, dan trigger terasa bisa diklik.

### Purchase Order ke Production Shortage

- Production Order detail sudah bisa menampilkan material shortage.
- Tombol `Buatkan PO` dari shortage sudah mengarahkan ke pembuatan PO dengan item kekurangan bahan.
- PO dari shortage membawa konteks:
  - `source=production`
  - `production_order_id`
  - nomor production order
  - daftar item bahan kurang

### Production Order Recheck Stock

- Backend Production Order sudah ditambahkan action `recheck_stock`.
- Detail Production Order sudah punya tombol `Cek Ulang Stok`.
- Tombol tersedia di:
  - action bar detail Production Order
  - alert `Stok belum cukup`
- Saat diklik, sistem melakukan cek ulang stok material dari backend.
- Jika bahan masih kurang, sistem menampilkan pesan jumlah bahan yang masih kurang.
- Jika stok sudah cukup, sistem memberi pesan bahwa Production Order bisa dilanjutkan sesuai statusnya.
- QA terakhir pada order `PROD-202605-0004`:
  - sistem membaca masih ada 3 bahan kurang
  - tombol `Release` tetap disabled karena stok belum cukup

### Release Production

Backend flow produksi sudah tersedia:

- Release order
- Start production
- Complete production
- Validasi kecukupan stok sebelum release/complete
- Mengurangi stok bahan baku saat complete
- Mencatat inventory movement untuk konsumsi material
- Membuat batch produksi
- Menambah stok output:
  - produk jadi
  - atau WIP jika output type adalah WIP
- Menghitung HPP aktual
- Update cost price produk POS untuk produk jadi

## Verifikasi Terakhir

- Lint scoped untuk file Production Order API dan detail page: passed.
- `git diff --check`: passed.
- Browser QA halaman detail Production Order:
  - halaman terbuka normal
  - tombol `Cek Ulang Stok` bisa diklik
  - pesan hasil recheck muncul
  - status shortage tetap terbaca benar

## Task Lanjutan Yang Disarankan

### 1. Production Complete UI

Tujuan: membuat proses finalisasi produksi jelas untuk user.

Yang perlu dibuat:

- Form complete production di detail Production Order.
- Input actual output qty.
- Input actual waste/susut.
- Input actual material consumption jika realisasi berbeda dari plan.
- Preview HPP aktual sebelum complete.
- Tombol `Complete Production`.
- Validasi jika stok material tidak cukup.

### 2. Production Movement History

Tujuan: user bisa audit perubahan status dan stok dari satu halaman.

Yang perlu ditampilkan:

- Riwayat release.
- Riwayat start production.
- Riwayat complete production.
- Material yang dipotong dari stok.
- Output stok yang masuk.
- HPP aktual hasil produksi.

### 3. Inventory Stock Card

Tujuan: semua perubahan stok bisa ditelusuri dari raw material, WIP, dan produk jadi.

Yang perlu dibuat:

- Halaman kartu stok per item.
- Saldo awal.
- Barang masuk dari PO.
- Konsumsi produksi.
- Adjustment.
- Saldo akhir.
- Link ke dokumen sumber seperti PO, penerimaan, atau production order.

### 4. WIP Handling

Tujuan: WIP bisa menjadi output produksi sekaligus bahan baku untuk produksi berikutnya.

Yang perlu dirapikan:

- Output produksi WIP masuk ke inventory WIP/raw material.
- WIP bisa dipilih sebagai komponen BOM produk final.
- HPP WIP terbawa ke produk final.
- Detail Production Order menampilkan apakah output adalah produk jadi atau WIP.

### 5. Purchase Order From Shortage Enhancement

Tujuan: flow buat PO dari shortage lebih otomatis.

Yang perlu dibuat:

- Group shortage by supplier.
- Jika bahan beda supplier, sistem bisa membuat beberapa PO.
- Setelah PO diterima, user diarahkan balik ke Production Order untuk `Cek Ulang Stok`.

## Prioritas Berikutnya

Urutan paling aman:

1. Production Complete UI.
2. Production Movement History.
3. Inventory Stock Card.
4. WIP Handling lanjutan.
5. PO from shortage multi-supplier.
