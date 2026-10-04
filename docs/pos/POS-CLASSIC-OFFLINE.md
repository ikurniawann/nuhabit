# POS Classic & Mode Offline

Status: POS Classic dihapus 2026-10-04 (keputusan owner: pertahankan kasir utama).
`/dashboard/pos/classic` sekarang redirect ke kasir utama (`cashierTabletRoute()`), menu
`pos.operations.cashier-classic` di-soft-delete oleh migrasi
`20261004191000_remove_classic_cashier_menu.sql`.

Registrar service worker ikut terhapus bersama Classic, jadi tidak ada halaman yang
mendaftarkan `public/sw.js` lagi. Browser yang pernah membuka Classic tetap memegang SW
lama sampai di-unregister. Antrian transaksi offline tetap jalan di kasir utama.

## Mode offline

| Lapisan | Mekanisme | Berkas |
|---|---|---|
| Halaman bisa dibuka tanpa internet | Service worker: `/_next/static` cache-first; navigasi & RSC `/dashboard/pos/*` dan GET API katalog/pengaturan kasir network-first dengan fallback cache. Respons redirect (mis. ke /login) tidak pernah di-cache. | `public/sw.js` (tanpa registrar sejak Classic dihapus), allowlist `/sw.js` di `src/lib/auth/middleware.ts` |
| Katalog & pelanggan | IndexedDB `arkiv-pos-db` (sudah ada sebelumnya) | `src/lib/pos-db.ts`, `loadCashierCatalog` / `loadCashierCustomers` di `src/features/pos/cashier/api.ts` |
| Transaksi offline | Payload `createOrder` disusun oleh `buildOfflineOrderPayload` (pemetaan item identik dengan `use-pos-checkout`) lalu masuk antrian IndexedDB; struk sementara `OFFLINE-…`. | `src/lib/pos/offline-sync.ts`, `src/hooks/use-pos-offline.ts` |
| Sinkron otomatis | Event `online` (+1,5 dtk) dan interval 45 dtk selama antrian belum kosong. Gagal jaringan/5xx → tetap `pending` (dicoba lagi); ditolak server (validasi/stok/stall) → `failed`, kasir memilih **Coba Lagi** atau **Buang**. Item tersangkut `syncing` dipulihkan saat halaman dibuka. | `use-pos-offline.ts` |

Batasan yang disengaja:

- Offline hanya tunai / QRIS statis / kartu. ARK Coin, gift card, NFC tab, FOC butuh validasi server.
- Nomor order resmi baru terbit saat sinkron; struk offline memakai nomor `OFFLINE-…`.
- Stok dicek saat sinkron, bukan saat transaksi offline; penolakan muncul sebagai item `failed`.
- Belum ada kunci idempoten di server: bila sinkron terputus tepat setelah server menyimpan
  tetapi sebelum respons sampai, order bisa terkirim dua kali (item tetap `pending`).
- Auto-sync aktif di POS utama; tombol "Sync Now" tetap ada.
