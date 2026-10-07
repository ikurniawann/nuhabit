# EPIC-027: Items & POS — Master Bersih, Stok Akurat, Satu Sumber Kebenaran Katalog

status: backlog
environment: local
retries: 0

## Goal

Venue **SULU-Dago** siap jual di POS tanpa “barang hantu”: master raw
material / product / BOM bersih, opening stock + opname akurat, katalog
POS = mirror `item.products` (satu sumber kebenaran), dan penjualan
diblok bila resep atau kebijakan stok tidak terpenuhi.

Prioritas go-live = **data master + stok akurat**. Polish operasional POS
hanya sebatas yang mendukung guard katalog & smoke path jual → potong stok.

## Keputusan Owner (2026-07-23)

Hasil scoping breakdown:

1. **Satu epic berfase** (Items fondasi → bridge → IA → POS polish),
   bukan dua epic terpisah.
2. **Definisi siap produksi** = master bersih + stok akurat (import RM /
   produk / BOM, opening, opname) — kasir tidak menjual SKU tanpa fondasi
   data.
3. **Integrasi POS luas**: sync harga/status, resep wajib sebelum jual,
   potong stok RM, kebijakan min-stock / allow-negative, **plus**
   penataan ulang menu POS Catalog agar tidak CRUD master paralel dengan
   Items.
4. **Pendekatan eksekusi horizontal** — tiap fase bisa di-QA/deploy
   sendiri; Fase A boleh go-live data sebelum polish POS selesai.

## Evidence / Aset Existing

- Menu IAM Items: `items` → raw-material / product (master, inventory,
  purchasing, approval, production) di `database/seeders/iam-menus.sql`.
- Route kanonik: `RM_ROUTES` / `PRODUCT_ROUTES`
  (`src/modules/purchasing/constants/item-routes.ts`).
- Import SULU: `docs/data/generate_sulu_import_excels.py` →
  `docs/data/sulu-import/` (RM, products, BOM).
- Bridge sudah ada: `pos.pos_products.source_product_id` +
  `src/lib/pos/purchasing-sync.ts` +
  `POST /api/pos/products/sync-purchasing`.
- Resep POS: `pos.pos_recipes` + recipe-builder UI; deduct stok via jalur
  transaksi POS (RPC / order path — diverifikasi & dikeraskan di Fase B).
- Stock alerts POS: `/dashboard/pos/stock-alerts`.
- Gap diketahui: Product stock transfer masih placeholder
  (`src/features/items/product/placeholder-config.ts`); dual surface
  master di Items Product vs POS Products.

## Fase

### Fase A — Items fondasi data

**Tujuan:** data master + stok venue siap diaudit sebelum kasir diandalkan.

| Task group | Scope (PR-sized) |
|---|---|
| **A1 Seed & import SULU-Dago** | Warehouse/stall codes (WH-01, STALL-*), generate + jalankan import RM + products + BOM; validasi jumlah baris & mapping stall |
| **A2 Opening stock + opname** | Opening stock per gudang; sesi opname RM (produk bila perlu); selisih → adjustment ter-audit |
| **A3 Inventory Product gap** | Tutup placeholder Product Stock Transfer; samakan UX stock / adjustment / opname Product dengan pola RM |
| **A4 Master hygiene** | Laporan orphan: unit/kategori kosong, produk tanpa satuan, RM tanpa `stok_minimum`; perbaikan batch |

**Dependensi:** A2 setelah A1; A3 parallel-ok dengan A2; A4 setelah A1.

### Fase B — Bridge Items ↔ POS

**Tujuan:** setiap SKU yang muncul di kasir punya sumber Items, resep, dan
perilaku stok yang deterministik.

| Task group | Scope (PR-sized) |
|---|---|
| **B1 Sync kontrak** | Perkuat sync `source_product_id` (nama, SKU, harga, status aktif); sync massal + re-sync otomatis saat update Items Product |
| **B2 Resep wajib jual** | Order API + kasir menolak produk aktif tanpa resep/BOM (atau tanpa komponen yang di-track stok) |
| **B3 Deduct stok** | Checkout potong RM via resep; audit trail; gagal sebagian tidak meninggalkan stok inkonsisten |
| **B4 Stock policy** | Setting allow-negative vs block-at-min; ditegakkan di order + stock-alerts |

**Dependensi:** B1 sebelum B2–B4; B3 butuh resep (B2) + stok A2; B4 bisa
paralel setelah B1.

### Fase C — IA satu sumber kebenaran

**Tujuan:** operator tidak mengedit master di dua tempat.

| Task group | Scope (PR-sized) |
|---|---|
| **C1 POS Catalog slim** | Menu POS Produk = katalog jual / sync / station saja; CRUD master mengarah ke Items Product |
| **C2 IAM & route Items** | Seragamkan code menu/route; grant baca katalog untuk role POS yang perlu; admin/purchasing tetap penuh |
| **C3 Deprecate dual-edit** | Blok/alihkan create-edit `pos_products` tanpa `source_product_id`; migrasi orphan ke Items bila ada |

**Dependensi:** C setelah B1 stabil (supaya slim catalog tidak merusak
kasir).

### Fase D — POS polish terbatas

**Tujuan:** guard UX + bukti smoke go-live — **bukan** fitur POS baru besar
(CFD, restaurant board, dll. sudah di epic lain).

| Task group | Scope (PR-sized) |
|---|---|
| **D1 Guard UI kasir** | Badge/lock produk tanpa resep atau stok kritis (selaras B2/B4) |
| **D2 Stock alerts** | Marquee/halaman alerts selaras policy B4; RM + produk at-risk |
| **D3 Smoke go-live** | Checklist UAT: import → sync → jual 1 SKU → stok turun → laporan closing/profit |

**Dependensi:** D1–D2 setelah B2/B4; D3 setelah A+B (+C disarankan).

## Urutan eksekusi

```text
A1 → A2 ─┬→ A4
         └→ A3 (parallel)
              ↓
         B1 → B2 → B3
              └→ B4 (parallel ok)
                   ↓
              C1 → C2 → C3
                   ↓
              D1 + D2 → D3
```

## Non-Goals (epic ini)

- Self-order kiosk, multi-outlet baru, channel marketplace.
- Webhook auto-confirm QRIS (ikut jalur EPIC-024 lanjut).
- Rombak total purchasing AP / vendor credit / e-Faktur.
- Ledger akuntansi terpadu POS + ticketing + AR (epic finance lanjut).
- Fitur POS besar di luar guard katalog/stok (restaurant merge, CFD, NFC
  bridge) — sudah / akan di epic terpisah.

## Acceptance Criteria

### Data & stok (wajib go-live)

- [ ] Import SULU-Dago: RM, products, BOM masuk dengan stall/warehouse
      terpetakan; laporan baris gagal kosong atau terdokumentasi.
- [ ] Opening stock + minimal satu siklus opname RM selesai; qty on-hand
      cocok dengan hasil opname untuk sampel gudang utama (WH-01).
- [ ] Tidak ada produk aktif di kasir tanpa `source_product_id` ke
      `item.products` (setelah C3; selama transisi B1: orphan tercatat).

### Bridge & kebijakan jual

- [ ] Ubah harga/status di Items Product → POS mirror ikut (sync/re-sync).
- [ ] Produk tanpa resep tidak bisa di-checkout (API 4xx + UI lock).
- [ ] Order sukses mengurangi stok RM sesuai resep; gagal deduct ≠ order
      “lunas tanpa potong stok”.
- [ ] Policy block-at-min menolak jual yang akan menembus minimum; mode
      allow-negative mengizinkan dengan jejak alert.

### IA

- [ ] CRUD master produk hanya dari Items Product; POS Catalog tidak
      menawarkan create/edit master paralel.
- [ ] Menu IAM/route konsisten; role POS bisa baca katalog yang dibutuhkan
      tanpa akses purchasing penuh kecuali di-grant.

### Smoke

- [ ] Path: sync 1 SKU ber-resep → jual di kasir → stok RM turun →
      terlihat di stock / alerts / laporan penjualan.

## Test Plan

- **Data:** hitung baris Excel import vs DB; spot-check 10 SKU + BOM.
- **API:** order tanpa resep → ditolak; order dengan resep → ledger stok
  bergerak; sync-purchasing idempotent.
- **UI:** kasir menampilkan lock/badge; POS Products tidak punya form
  master penuh setelah C1.
- **UAT venue:** checklist D3 di branch SULU-DAGO (dev dulu, lalu staging
  bila ada).

## Catatan Keterkaitan

- **EPIC-024** POS Customer Display — independen; jangan digabung scope.
- **EPIC-011** CRM / privilege `min_xp` di `pos_products` — sync Items
  harus mempertahankan field POS-only (station, min_xp, dll.).
- Purchasing admin access (`admin` di API purchasing) — prasyarat operasional
  import/seed, bukan deliverable utama epic ini.
- Generator import: `docs/data/generate_sulu_import_excels.py` (nama sumber
  masih “SULU Bandung”; target branch operasional = SULU-DAGO).

## Automation Log

- 2026-07-23 — Epic dibuat dari breakdown owner: opsi C (Items+POS
  berfase), go-live = master+stok (A), integrasi luas + IA satu sumber
  kebenaran (C), pendekatan eksekusi horizontal (1). Status **backlog** —
  menunggu owner menandai on-progress / mulai Fase A1.
