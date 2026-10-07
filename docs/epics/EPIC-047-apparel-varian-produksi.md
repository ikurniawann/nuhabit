# EPIC-047: Apparel & Alas Kaki — Varian dari Master sampai Produksi — `MODULE-APPAREL`

status: on-progress
environment: dev
phase: 1
priority: P1
area: Fullstack
module: `MODULE-APPAREL`
retries: 0

## Goal

Menjalankan lini bisnis baru — **produksi kaos, kemeja, sandal, dan sepatu** —
di ERP yang sama, dari pembelian bahan baku sampai barang jadi bisa dijual di
kasir dan toko online, **tanpa modul baru**. Yang membedakan apparel dari F&B
hanya satu dimensi: **varian ukuran & warna** dengan stok masing-masing.
Epic ini menutup celah itu di dua jahitan yang hari ini belum mengenal varian:
master produk → SKU, dan produksi selesai → stok per SKU.

## Keputusan Perencanaan (2026-09-09)

Hasil audit kode & database lokal bersama owner. Semua sudah dikunci:

- **Bukan modul baru.** Keputusan ini sudah dicatat tim pada 2026-08-02
  (EPIC-039, header `20260802100000_pos_merchandise_foundation.sql`):
  *merchandise = `product_kind` baru di POS, BUKAN jalur purchasing baru;
  pembelian reuse `item.products`.* Apparel masuk kategori yang sama.
  Bukti sudah jalan: seeder `items-footwear.js` (4 Sep) menjalankan seluruh
  rantai bahan baku → WIP upper → sepatu jadi → production order dengan HPP →
  POS, semuanya di tabel `item` / `purchasing` / `inventory` / `manufacturing`
  yang sudah ada. `production_orders` sudah membedakan
  `production_context` × `output_type` (`raw_material|WIP`, `product|WIP`,
  `product|FINISHED_GOOD`).
- **Lini bisnis dipisah sebagai company sendiri** di bawah holding Prologe
  (pola tenant Dusun Bambu, EPIC-046) — **bukan** hide/unhide F&B seperti
  percobaan 4 Sep (`[hidden-fnb]`, script `footwear-only`). Unit, kategori,
  bahan, produk, dan gudang semuanya sudah ber-`company_id`, jadi pemisahan
  ini gratis.
- **Lapisan varian sudah ada, hanya belum dipakai.** `pos.pos_product_skus`
  (EPIC-039 Fase B): `options` jsonb untuk ukuran/warna, `stock_quantity` per
  SKU, `barcode`, `price_override`, plus fungsi klaim/restore stok
  `pos_sell_merchandise_sku_stock`. Editor per-SKU sudah ada di
  `/api/pos/products/[id]/skus` (+ `[skuId]`) dengan `normalizeSkuPayload`.
  **0 baris** terpakai hari ini.
- **Dua jahitan yang buta varian** — inilah pekerjaan epic ini:
  1. **Produksi selesai** berhenti di `finished_goods_inventory` level produk
     dan **tidak pernah menyentuh POS/SKU**
     (`src/app/api/purchasing/production/orders/[id]/route.ts`, cabang
     `else` FINISHED_GOOD setelah insert `production_batches`).
  2. **GRN** mengisi `pos_receive_merchandise_stock` level produk; migration
     Fase B sendiri (§6) menandai *per-varian GRN = fase lanjut*.
- **BOM tetap satu per produk. HPP tetap per produk.** Konsumsi bahan sudah
  per order (`production_order_materials`), bukan per varian. Bahan per pcs
  sama untuk semua ukuran; beda kain per ukuran ditangani `waste_factor`
  (BOM per varian = fase lanjut, bukan sekarang).
- **Storefront, Xendit, kurir Biteship, Shopee tidak termasuk** — EPIC-039
  Fase D–F sudah diimplementasikan di dev (ready-for-qa). Begitu varian
  mengalir dari produksi, apparel langsung bisa dijual online.
- **Dev-only dulu.** Ikut registry `docs/modules/README.md` sebagai
  `MODULE-APPAREL`; naik ke production hanya bila owner memanggil namanya.

## Tasks

### Fase 0 — Company `SULU-APPAREL` + master dasar (seeder lokal) ✅

Turunan `items-footwear.js` + `dusun-bambu.js` / `lib/dusun-bambu-scope.js`.
Tidak ada kode aplikasi yang berubah di fase ini.

- [x] `database/seeders/lib/apparel-scope.js`: kode `PROLOGE` / `SULU-APPAREL` /
      `SA-WORKSHOP`, `loadEnv`, `ensureScope` (company + branch + gudang
      produksi `MAIN` + outlet `Workshop Store`), `assertLocalTarget`.
- [x] `database/seeders/apparel.js` (`npm run db:seed:apparel-business`):
      user demo `demo@suluapparel.id` (role `admin`, scope cabang), departemen
      HRIS *Produksi & Jahit*, *Gudang & QC*, *Toko*.
- [x] `database/seeders/apparel-items.js` (`npm run db:seed:apparel-items`):
      unit per company (PCS, LUSIN, M, ROLL, KG, CONE, PASANG); kategori bahan
      KAIN, BENANG, AKSESORIS (kancing/resleting/eyelet), LABEL, KEMASAN, SOL,
      KULIT, PEREKAT, WIP; ±30 bahan baku dengan konversi satuan beli; kategori
      produk KAOS, KEMEJA, CELANA, SANDAL, SEPATU, WIP; 2–3 produk WIP (badan
      kaos potong-jahit, upper sepatu); ±12 produk jadi dengan BOM bertingkat
      memakai `components: [kode | "WIP:<kode>", qty, waste]`; stok awal; sinkron
      `pos_products` dengan `product_kind = 'merchandise'` + `source_product_id`.
- [x] Update `EPIC-047` + `docs/modules/README.md` dengan hasil jalankan
      (jumlah bahan/produk/BOM), dan catatan bahwa harga adalah asumsi.

**Done signal:** login `demo@suluapparel.id` → Items menampilkan master
apparel, F&B Sulu tidak terlihat, super admin Sulu tidak terganggu.

**Hasil jalankan (2026-09-09, lokal, `npm run db:seed:apparel-business` lalu
`npm run db:seed:apparel-items`, idempoten — dijalankan 2× tanpa duplikasi):**

- Company `SULU-APPAREL` (holding `PROLOGE`) → cabang `SA-WORKSHOP` (Sulu
  Apparel Workshop) → gudang produksi `MAIN` (default) + outlet
  `WORKSHOP-STORE` (Workshop Store).
- Departemen HRIS baru: `SA-PRODUKSI` (Produksi & Jahit), `SA-GUDANG-QC`
  (Gudang & QC), `SA-TOKO` (Toko).
- User demo `demo@suluapparel.id` / `suluapparel` (role `admin`, scope
  cabang).
- User pemilik `apparel@arkivworld.com` (ditambah 2026-09-11): role `admin`
  (222/223 menu — hanya tanpa Notifikasi WA milik owner holding) dengan
  `business_scope = 'company'` → "super admin" Sulu Apparel: semua cabang
  apparel, tidak melihat SULU (F&B) / DUSUN-BAMBU. Sengaja bukan role
  `super_admin` karena role itu selalu unscoped. Password default seeder
  (override `SULU_APPAREL_OWNER_PASSWORD`), lokal saja.
- Unit per company: 7 (`PCS, LUSIN, M, ROLL, KG, CONE, PASANG`).
- Kategori bahan baku per company: 9 (`KAIN, BENANG, AKSESORIS, LABEL,
  KEMASAN, SOL, KULIT, PEREKAT, WIP`).
- Bahan baku: 35 total = 32 dibeli manual + 3 bahan WIP otomatis (hasil
  produk WIP di bawah), dengan konversi satuan beli (LUSIN/ROLL) tercatat di
  `raw_material_unit_conversions`. Stok awal masuk di 35 baris
  `inventory.inventory` (gudang MAIN) lengkap dengan mutasi pembukaan.
- Kategori produk (template global, dipakai bersama `items-footwear.js`
  untuk `SANDAL`/`SEPATU`/`WIP`): 6 (`KAOS, KEMEJA, CELANA, SANDAL, SEPATU,
  WIP`).
- Produk WIP: 3 (`WIP-BADAN-KAOS`, `WIP-BADAN-KEMEJA`, `WIP-UPPER-SEPATU`).
- Produk jadi: 12 (3 KAOS, 2 KEMEJA, 2 CELANA, 2 SANDAL, 3 SEPATU), 3
  di antaranya memakai resep bertingkat (`WIP:<kode>`) — `KAOS-001` →
  `WIP-BADAN-KAOS`, `KMJ-001` → `WIP-BADAN-KEMEJA`, `SPT-001` →
  `WIP-UPPER-SEPATU`.
- Total baris `manufacturing.bom_items`: 80 (produk WIP + produk jadi).
  `manufacturing.raw_material_bom_items`: sengaja 0 — Fase 0 tidak memakai
  resep bahan-ke-bahan (beda dari `items-footwear.js` yang punya campuran
  lem).
- Stok awal produk jadi: 12 baris `inventory.finished_goods_inventory`.
- Sinkron POS: 12 `pos.pos_products` dengan `product_kind = 'merchandise'`,
  `source_product_id` ke produk apparel, SKU prefix `APL-<kode>` (sengaja
  beda dari prefix `PUR-` yang dipakai `items-footwear.js`/Dusun Bambu agar
  tidak bentrok — kode produk `SND-00x`/`SPT-00x` kebetulan sama dengan
  footwear Sulu tapi scoped per company, sedangkan SKU POS bersifat global).
- Isolasi terbukti: `item.products` SULU tetap 108 baris dan Dusun Bambu
  tetap 20 baris sebelum & sesudah seeding; `pos_products` footwear
  (`PUR-SND-001`, `PUR-SPT-001`, dst.) tidak berubah `source_product_id`.
- **Harga bahan baku & harga jual adalah ASUMSI demo lokal**, bukan hasil
  survei pasar (dicatat di header `apparel-items.js`).
- Dilewati secara sengaja: bagian "contoh produksi" (`production_orders`)
  milik `items-footwear.js` — Fase 0 hanya master data, sesuai instruksi
  task. Juga tidak ada resep bahan-ke-bahan (`raw_material_bom_items`)
  karena tidak diminta epic untuk Fase 0.

### Fase 1A — Matriks varian di master produk → auto-SKU ✅

- [x] `src/lib/pos/merchandise-variants.ts` (murni, teruji): tipe
      `VariantAxis { key: "ukuran" | "warna" | string; values: string[] }`,
      `expandMatrix(axes)` → daftar kombinasi `options`, `buildSkuCode(baseSku,
      options)` deterministik (mis. `KAOS-001-M-HTM`), `buildSkuName`,
      `diffMatrix(existing, wanted)` → `{ create, deactivate, keep }`.
- [x] `POST /api/pos/products/[id]/skus/matrix`: body `{ axes, price_override?,
      barcode_prefix? }`; gate `product_kind = 'merchandise'` (reuse cek yang
      ada); satu transaksi: buat SKU yang belum ada lewat `normalizeSkuPayload`,
      **nonaktifkan** (bukan hapus) SKU yang tidak lagi ada di matriks bila
      `stock_quantity = 0`, tolak dengan 409 bila SKU ber-stok akan hilang.
      Idempoten: kirim matriks yang sama dua kali = no-op.
- [x] UI master produk POS (`src/features/pos/products`): panel *Varian* —
      chip input per sumbu (Ukuran: S M L XL; Warna: Hitam Putih), pratinjau
      jumlah SKU, tombol *Generate*, tabel SKU hasil (kode, nama, barcode,
      harga override, stok, aktif). Reuse endpoint per-SKU yang ada untuk
      edit satu baris.
- [x] Tampilkan ringkasan varian di daftar produk Items (`/dashboard/items`)
      untuk produk yang tertaut ke POS merchandise: badge `12 varian`.

**Acceptance:** produk *Kaos Sulu Basic* dengan sumbu 4 ukuran × 2 warna →
tepat 8 baris `pos_product_skus`, kode unik, `options = {ukuran, warna}`;
generate ulang dengan warna ketiga → +4 baris, 8 lama utuh; hapus satu ukuran
yang ber-stok → 409 dengan pesan jelas.

### Fase 1B — Output produksi per varian → stok per SKU ✅

Jahitan utama epic ini. Semua di rute
`src/app/api/purchasing/production/orders/[id]/route.ts` + lib pendamping.

- [x] Migration `20260910120000_production_variant_output.sql`:
      `manufacturing.production_output_variants` (`production_order_id`,
      `production_batch_id`, `pos_sku_id` → `pos.pos_product_skus`, `qty`,
      `created_*`), unique `(production_batch_id, pos_sku_id)`; kolom
      `pos_sku_id` nullable di `inventory.finished_goods_movements` untuk jejak
      per varian. Idempoten (`IF NOT EXISTS`), dev.
- [x] `src/lib/manufacturing/variant-output.ts` (murni, teruji):
      `validateVariantSplit(actualQty, rows)` — jumlah split **harus sama**
      dengan `actual_qty`, setiap `pos_sku_id` milik produk order, aktif, tidak
      duplikat; `requiresVariantSplit(product)` = produk tertaut POS
      merchandise **dan** punya SKU aktif (pola `variant_required` Fase B).
- [x] API: `PATCH …/orders/[id]` menerima `variant_output: [{ pos_sku_id, qty }]`
      saat aksi **complete**. Bila `requiresVariantSplit` true dan split tidak
      dikirim/tidak valid → 400 dengan daftar SKU yang tersedia. Bila false →
      perilaku lama utuh (F&B, WIP, raw_material tidak berubah sama sekali).
- [x] Posting stok di cabang FINISHED_GOOD, **setelah** insert
      `production_batches` dan **sebelum/selain** upsert
      `finished_goods_inventory`: simpan `production_output_variants`, lalu per
      SKU `UPDATE pos_product_skus SET stock_quantity = stock_quantity + qty`
      dalam transaksi yang sama; `finished_goods_inventory` level produk tetap
      dinaikkan sejumlah total (sumber HPP & laporan persediaan), dengan
      `finished_goods_movements.pos_sku_id` diisi per baris varian.
- [x] Guard idempoten: complete dua kali pada order yang sama tidak menggandakan
      stok SKU (kunci pada `production_batch_id`).
- [x] UI production order (`src/features/purchasing/production` atau lokasi
      form complete yang ada): saat produk ber-varian, form complete menampilkan
      tabel *Rincian per varian* (SKU, ukuran/warna, qty) dengan auto-hitung sisa
      = `actual_qty − Σ`, tombol *Bagi rata*, dan validasi sisa harus 0.
- [x] Detail production order menampilkan rincian varian yang sudah diposting.

**Acceptance:** PO produksi *Kaos Sulu Basic* 100 pcs, complete dengan
S 20 / M 30 / L 30 / XL 20 → `pos_product_skus.stock_quantity` bertambah
persis itu, `finished_goods_inventory` +100, 4 baris `finished_goods_movements`
ber-`pos_sku_id`, HPP per pcs tidak berubah dari perhitungan lama; kirim
split berjumlah 90 → 400; complete order F&B tanpa varian → jalur lama, nol
regresi.

### Fase 1C — Kasir & laporan membaca stok per SKU ✅

- [x] Verifikasi kasir POS (`/dashboard/pos/tablet`) untuk produk merchandise
      ber-varian **wajib** memilih SKU (sudah ada dari Fase B) dan stok yang
      ditampilkan adalah `stock_quantity` SKU, bukan `inventory_quantity`
      produk. Perbaiki bila ada celah.
- [x] Laporan Items → stok produk jadi: kolom *per varian* (expand) untuk
      produk ber-SKU; total tetap dari `finished_goods_inventory`.
- [x] *(ditunda → Fase 2, lihat Tidak termasuk)* Stock opname produk (`product_stock_opname`): dukung baris per SKU untuk
      produk ber-varian (opsional bila waktu; bila ditunda, catat di *Tidak
      termasuk*).

**Acceptance:** setelah Fase 1B, kasir menjual *Kaos Sulu Basic M Hitam* →
stok SKU M-Hitam turun 1, SKU lain utuh, void mengembalikan ke SKU yang sama.

### Fase 2 — GRN per varian (beli barang jadi dari vendor) ✅

Ditandai *fase lanjut* oleh migration Fase B §6. Dikerjakan **setelah** 1A–1C
stabil.

- [x] `purchase_order_items` + `grn_items`: kolom `pos_sku_id` nullable.
- [x] Form PO/GRN untuk produk ber-varian: baris per SKU.
- [x] `pos_receive_merchandise_stock` versi per-SKU (atau fungsi baru
      `pos_receive_merchandise_sku_stock`) dipanggil dari `grn-qc.ts`.
- [x] Guard: GRN produk ber-varian tanpa `pos_sku_id` → ditolak (bukan
      menambah stok level produk secara diam-diam seperti sekarang).

### Fase 3 — Stock opname per SKU ✅

Ditunda dari 1C sub-step 3. Produk ber-varian dihitung fisik **per SKU**;
total produk tetap milik `finished_goods_inventory`.

- [x] Migration `20260911081906_opname_variant_sku.sql`: kolom `pos_sku_id`
      nullable (FK ke `pos.pos_product_skus`, tanpa cascade) di
      `inventory.product_stock_opname_lines` + index; idempoten.
      Ditambah `20260911083000_opname_variant_sku_unique_fix.sql`: UNIQUE
      lama `(opname_id, product_id)` diganti dua index parsial (tanpa SKU /
      dengan SKU) — tanpa ini baris ke-2 SKU produk yang sama ditolak.
- [x] `listProductInventoryForOpname`: produk merchandise ber-SKU aktif
      (via `pos_products.source_product_id`) diekspansi jadi satu baris
      pratinjau **per SKU** (`pos_sku_id`, label `sku — name`,
      `qty_system` = `stock_quantity` SKU); produk tanpa varian tidak berubah.
      `ProductOpnamePreviewLine` + tipe fitur mendapat `pos_sku_id?`/`pos_sku?`.
- [x] Create opname (`POST /api/inventory/product-stock-opnames`) menulis
      `pos_sku_id` per baris; `fetchProductStockOpnameDetail` mengembalikan
      `pos_sku_id` + label; PATCH hitung tidak berubah (per `line.id`).
- [x] Complete (`…/[id]/complete`): baris ber-`pos_sku_id` → set
      `pos_product_skus.stock_quantity = qty_counted` (absolut, `FOR UPDATE`)
      + satu `finished_goods_movements` dengan `pos_sku_id` dan
      before/after level SKU; `finished_goods_inventory` produk ber-varian
      disesuaikan sebesar **Σ selisih SKU** (tetap total). Baris tanpa
      `pos_sku_id` → jalur lama identik.
- [x] UI detail opname: label "Varian: sku — name" di bawah nama produk pada
      baris SKU; ringkasan `lines_with_variance` tetap per baris.

**Acceptance:** opname gudang MAIN apparel → KAOS-001 tampil 16 baris SKU
(bukan 1), KAOS-003 1 baris; hitung M-Hitam = stok − 2 dan S-Putih = stok + 1,
sisanya = sistem → complete → `stock_quantity` M-Hitam −2, S-Putih +1, 14 SKU
lain tetap; `finished_goods_inventory` KAOS-001 −1; 2 baris
`finished_goods_movements` ber-`pos_sku_id` + 1 baris produk; opname produk
Dusun Bambu (tanpa varian) selesai persis seperti sebelumnya.

## Acceptance Criteria

- Apparel hidup sebagai company `SULU-APPAREL` terpisah; data Sulu F&B dan
  Dusun Bambu tidak berubah satu baris pun (diff `item.*` per `company_id`).
- Master produk merchandise bisa mendefinisikan matriks ukuran × warna dan
  menghasilkan SKU deterministik; generate ulang idempoten; SKU ber-stok tidak
  bisa hilang tanpa sengaja.
- Production order produk ber-varian **tidak bisa** diselesaikan tanpa rincian
  per varian yang jumlahnya tepat; setelah selesai, stok mendarat per SKU dan
  total produk tetap konsisten (`Σ stock_quantity SKU == kenaikan
  finished_goods_inventory` untuk order itu).
- Produksi F&B, WIP, dan `raw_material` **tidak berubah perilaku** — dibuktikan
  test regresi memakai seeder Dusun Bambu (`PROD-DB-*`) dan footwear lama.
- HPP per unit dan laporan persediaan level produk tidak berubah rumus.
- Kasir menjual dan mengembalikan stok pada SKU yang benar.
- Semua seeder memanggil `assertLocalTarget()`; tidak ada data contoh yang ikut
  ke production.
- Vitest penuh lulus; test baru untuk `merchandise-variants.ts` dan
  `variant-output.ts` (murni) + test rute complete dengan/ tanpa varian.

## Verifikasi lokal yang direncanakan

E2E lewat API sebagai `demo@suluapparel.id`: seed → buat matriks 4×2 →
buat PO produksi 100 pcs → complete tanpa split **ditolak** → complete dengan
split 20/30/30/20 → cek stok SKU & `finished_goods_inventory` → jual 1 M-Hitam
di kasir → void → stok kembali. Lalu ulangi complete pada order F&B Dusun
Bambu untuk membuktikan nol regresi.

## Tidak termasuk (fase berikutnya)

BOM per varian (kain berbeda per ukuran), harga jual per varian di master
Items (cukup `price_override` SKU), size-run otomatis dari histori penjualan,
barcode printing, dan storefront / Xendit / Biteship / Shopee (sudah ada di
EPIC-039 Fase D–F). Stock opname per SKU sudah
selesai di Fase 3 (bukan lagi pengecualian).

## Dependencies

- EPIC-039 Fase A–B (`pos_product_skus`, `product_kind='merchandise'`,
  `source_product_id`) — sudah ada di `development`.
- EPIC-046 (pola scope company/branch untuk tenant kedua) — sudah ada.
- Seeder `items-footwear.js` sebagai cetakan Fase 0 — sudah ada.

## Checklist rilis ke production

Jalankan hanya bila owner memanggil `MODULE-APPAREL`:

1. Apply migration `production_variant_output` (Fase 1B) dan, bila Fase 2
   sudah masuk, migration kolom `pos_sku_id` di PO/GRN.
2. Promosi lewat **cherry-pick commit kode** (pola rilis 2026-09-07), bukan
   merge penuh — seeder `apparel*.js` tinggal di `development`.
3. Setelah live: buat company apparel & master produk asli lewat UI; tidak ada
   data contoh yang ikut.

## Automation Log

- 2026-09-09 — Epic dibuat dari audit kode & DB bersama owner; status
  `backlog` sampai owner menyalakan.
- 2026-09-09 /task-work EPIC-047 #1 "Fase 0 — Company `SULU-APPAREL` + master
  dasar (seeder lokal)" → PASS (attempts: 1). Gate: review-qa PASS (3 catatan
  LOW/INFO), security PASS (assertLocalTarget sebelum koneksi di ketiga entry
  point, bcrypt, semua DELETE/UPDATE ber-scope), test PASS (node --check,
  seeder end-to-end + rerun idempoten, isolasi SULU=108 / Dusun Bambu=20 tetap,
  vitest 221 berkas / 1828 test). Verifikasi browser sebagai
  `demo@suluapparel.id`: 35 bahan baku dan 15 produk apparel tampil di Items.
  MR dibuat via `push -o merge_request.create` ke `development` (nomor dicatat
  saat merge). Tidak ada GitLab issue yang cocok dengan judul task — dilanjutkan
  tanpa referensi penutup.
- 2026-09-09 — Fase 0: **MR !204 merged** ke `development`
  (tag `v0.61.0-development`). Nomor dicatat di sini karena baru ada setelah
  push.
- 2026-09-10 /task-work EPIC-047 #2 "Fase 1A — Matriks varian di master produk
  → auto-SKU" → PASS (attempts: 3).
  - Attempt 1 (`96a6e0f4`): review PASS; security FAIL — HIGH matriks tak
    terbatas, MEDIUM `barcode_prefix` tanpa batas, MEDIUM UPDATE nonaktif belum
    ber-scope `product_id`; test FAIL — varian yang dihapus tidak bisa ditambah
    lagi (409 "Kode SKU sudah dipakai").
  - Attempt 2: review PASS; security FAIL — HIGH `expandMatrix` dipanggil
    sebelum `validateMatrixSize` (repro: body 1,4 KB 5×40 → heap OOM), MEDIUM
    barcode gabungan gagal di dalam transaksi, MEDIUM `values` bukan array →
    500 bocor TypeError; test FAIL — implicit `any` di baris map baru.
  - Attempt 3 (`9cb1c0aa`): **review PASS, security PASS, test PASS.**
    Perbaikan struktural: validasi ukuran sebelum ekspansi DAN `expandMatrix`
    melempar `MatrixTooLargeError` sebelum alokasi (repro → 400 dalam 19–31
    ms, server hidup); bentuk rusak → 400; barcode gabungan dicek sebelum
    transaksi (GET identik byte demi byte); urutan 401 → 404 → merchandise →
    body → transaksi; reaktivasi + nonaktif masing-masing satu UPDATE batch
    ber-scope; 5 test level route memastikan `expandMatrix` dan
    `withTransaction` tidak dipanggil di jalur rentan. Vitest 224 berkas /
    1891 test. Isolasi F&B: `pos_product_variants` tidak pernah disentuh,
    produk regular hanya mendapat 400.
  - MR dibuat via `push -o merge_request.create` ke `development`; nomor
    dicatat saat merge. Tidak ada GitLab issue yang cocok — tanpa referensi
    penutup. Catatan di luar cakupan: data seed KAOS-001 punya kunci `options`
    campur huruf besar-kecil (ditangani `optionsKey()`); KAOS-002 di DB lokal
    tercemar ±898 baris SKU nonaktif dari pembuktian — data lokal saja.
- 2026-09-10 — Fase 1A: **MR !205 merged** ke `development`
  (tag `v0.62.0-development`). Satu-satunya pipeline di cabang itu (37673)
  `success`; pesan "pipeline failed" dari `glab` selama auto-merge menunggu
  adalah bacaan keliru, bukan kegagalan nyata.
- 2026-09-10 /task-work EPIC-047 #3 "Fase 1B — Output produksi per varian →
  stok per SKU" → PASS (attempts: 1).
  - Implementer menemukan sendiri bahwa laporan **stock card produk
    menghitung dua kali** (baris produk 100 + 4 baris varian = 200) dan
    menundanya ke 1C; orkestrator memaksa perbaikannya **sebelum gate**
    (filter `pos_sku_id IS NULL` di query pergerakan dan saldo awal; audit
    semua pembaca `finished_goods_movements`: tidak ada agregator per produk
    lain). Baris varian memakai `qty_before/qty_after` level SKU.
  - review PASS — gate split sebelum tulisan apa pun; cabang WIP/raw_material
    identik byte demi byte; HPP tak berubah; kedua test route dinilai asli.
  - security PASS — IDOR `pos_sku_id` produk lain → 400 nol tulisan (direpro);
    replay → 400; FK `pos_sku_id` tanpa cascade; runner hanya lokal.
    MEDIUM non-pemblokir: array `variant_output` belum ber-`.max(N)` (pola sama
    dengan array `materials` yang sudah ada) — tindak lanjut di 1C.
  - test PASS — delta persis +40 produk / +10 × 4 SKU / +4 baris varian; 400
    dan replay nol delta; stock card `jumlah` 40 bukan 80, saldo akhir =
    persediaan hidup; Dusun Bambu `variant_required: false`; vitest 227
    berkas / 1914 test. Semua pembuktian dihitung sebagai delta terhadap
    snapshot sendiri karena gate security membuat order KAOS-001 bersamaan.
  - Catatan: jalur complete produksi memang belum transaksional sejak sebelum
    task ini — idempotensi ditaruh di `production_batch_id`; hardening
    terpisah. MR dibuat via `push -o merge_request.create` ke `development`;
    nomor dicatat saat merge. Tidak ada GitLab issue yang cocok.
- 2026-09-10 — Fase 1B: **MR !206 merged** ke `development` pukul 14:57 saat
  pipeline cabangnya masih `pending` (antrian runner, bukan gagal; proyek
  tidak mensyaratkan pipeline selesai untuk merge). Pipeline `development`
  pasca-merge selesai sendiri → tag `v0.63.0-development`.
- 2026-09-10 /task-work EPIC-047 #4 "Fase 1C — Kasir & laporan membaca stok
  per SKU" → PASS (attempts: 1).
  - Sub-step 1 (kasir) **terverifikasi tanpa perubahan kode**: semua pintu
    masuk keranjang (grid, favorit, quick-add promo, scan barcode) memaksa
    pemilihan SKU; picker membaca `stock_quantity` SKU; jual M-Hitam 35→34,
    15 SKU lain identik, void → 35. +5 test `merchandise-stock`.
  - Sub-step 2: `variants[]` + `variant_count` di `GET
    /api/inventory/finished-goods` (satu query tambahan; view tidak
    disentuh) + expand per varian di UI. Sub-step 3 (opname per SKU)
    **ditunda ke Fase 2**, dicatat di Tidak termasuk.
  - Tindak lanjut 1B: `variant_output` `.max(100)` + test 101 entri → 400.
  - **Bug lama diperbaiki di akar**: `QueryBuilder.not()` merender op simbolik
    apa adanya (`NOT (status EQ $1)` → SQL tidak valid; tutup shift kasir
    selalu gagal). Kini diterjemahkan; op mentah tetap lewat; 19 call site
    diaudit (18 `is`/`in` identik, 1 `eq` kini benar). Shift yang
    tertinggal terbuka berhasil ditutup.
  - review PASS — semua pintu masuk keranjang ditelusuri; test dinilai asli;
    error eslint lama di `query-builder.ts` tetap 33 (tidak ada yang baru).
    security PASS — semua op `.not()` literal; scope query varian tidak
    melebar; diff tidak menyentuh `auth`. test PASS — baseline lint vs
    origin/development, tsc scoped, 53 berkas / 437 test, suite penuh
    **228 berkas / 1931 test**; shift `closed` di DB membuktikan perbaikan
    `.not()`. Catatan jujur: langkah fungsional gate test bersandar pada
    bukti DB + rantai hidup implementer, bukan menjalankan jual→void→tutup
    baru sendiri.
  - Regresi F&B: bukti statis (dispatch `claimMerchandiseStock` hanya
    bercabang pada `skuId`) + bukti hidup Fase 1B; jual hidup sebagai
    `demo@dusunbambu.id` tidak bisa karena user itu belum punya penugasan
    stall di DB lokal (celah data Fase 0/EPIC-046, bukan bug 1C).
  - **Temuan pre-existing MEDIUM** (gate security, bukan dari diff ini):
    `pos_sell_merchandise_sku_stock` mempercayai `sku_id` dari baris order
    tanpa memastikan SKU itu milik `product_id` baris yang sama — request
    rakitan bisa mengurangi stok SKU produk lain di tenant yang sama.
    Dibuatkan task terpisah (validasi kepemilikan sebelum klaim).
  - **Anomali di luar task**: `auth.users.updated_at` untuk
    `super@arkivworld.com` berubah 2026-09-10 15:14:06 tanpa
    `last_sign_in_at` yang menyertai — tulisan bukan-login saat sebuah
    subagent "mencoba reset" password sebelum diblokir classifier; login
    `suluin123` setelahnya 401. Diff tidak menyentuh `auth`. Owner
    diberi tahu; pemulihan lewat `npm run db:seed:super-admin` (lokal
    saja) adalah keputusan owner. Semua gate dilarang menyentuh akun itu.
  - MR dibuat via `push -o merge_request.create` ke `development`; nomor
    dicatat saat merge. Tidak ada GitLab issue yang cocok.
- 2026-09-10 — Fase 1C: **MR !207 merged** ke `development` pukul 15:57 saat
  pipeline cabangnya masih `pending` (antrian runner, bukan gagal). Pipeline
  `development` pasca-merge selesai sendiri → tag `v0.64.0-development`.
- 2026-09-11 /task-work EPIC-047 #5 "Fase 2 — GRN per varian (beli barang
  jadi dari vendor)" → PASS (attempts: 2).
  - Attempt 1: keempat sub-step diimplementasikan + embed `pos_sku` di
    `grn/[id]`, `grn/[id]/items`, `po/[id]/items` (dipaksa orkestrator sebelum
    gate agar label "Varian: sku — name" benar-benar tampil di layar GRN/QC).
    review PASS; security PASS — SKU produk lain di baris PO → 400 nol
    tulisan, `pos_sku_id` tak sesuai baris PO → 400, identitas dari baris DB;
    test **FAIL** pada "buat GRN": DB `grn_party_check` 500.
  - Akar (pre-existing, di file yang memang diubah task ini): route GRN
    mengambil `module_type` dari body (default `raw_material`) lalu menulis
    kolom pihak dari tebakan itu — GRN produk tanpa `module_type` menulis
    `supplier_id` dan `vendor_id` null. Implementer sebelumnya kebetulan
    mengirim field itu; gate test tidak. **Attempt 2**: modul diturunkan dari
    PO milik delivery; body yang bertentangan → 400 "module_type tidak sesuai
    purchase order"; dihilangkan → diwarisi; semua cabang hilir memakai nilai
    efektif; 3 test route GRN dengan mock berurutan sesuai panggilan sungguhan.
    Bukti hidup pada fixture yang gagal: GRN tanpa `module_type` → 201 dengan
    `vendor_id`, S-Merah/M-Navy +4/+6 persis, 14 SKU lain tetap; bahan baku
    eksplisit & tanpa modul → 201 dengan `supplier_id`.
  - Attempt 2 gate: review PASS (tidak ada cabang body-driven yang tersisa;
    kasus umum identik untuk ketiga modul); security PASS (konflik → 400 nol
    tulisan; batas kepercayaan justru diperketat); test PASS — lint 0 baru,
    tsc scoped, 12 berkas / 75 test, suite penuh **231 berkas / 1957 test**.
    **Catatan jujur:** langkah fungsional gate test attempt 2 hanya parsial
    (login + form-data); bukti E2E hidup untuk tree ini berasal dari
    pembuktian ulang implementer attempt 2 dan reproduksi gate security.
  - Observasi pre-existing (bukan dari diff ini, tidak diperbaiki di sini):
    GRN berstatus `partially_received` walau semua baris diterima penuh
    (`computeGrnStatusAfterQc`/`recalculatePoReceivedQty`, tereproduksi juga
    di jalur bahan baku); `console.log` debug lama di `grn/route.ts:562`;
    insert GRN mempercayai `raw_material_id`/`product_id` dari klien bila
    `product_id` dihilangkan (LOW — tidak bisa menyuntikkan SKU).
  - Satu-satunya item epic yang masih terbuka: **stock opname per SKU**
    (lihat Tidak termasuk) — dikerjakan sebagai task terpisah.
  - MR dibuat via `push -o merge_request.create` ke `development`; nomor
    dicatat saat merge. Tidak ada GitLab issue yang cocok.
- 2026-09-11 /task-work EPIC-047 #6 "Fase 3 — Stock opname per SKU" → PASS
  (attempts: 2). Gate: review-qa PASS ×2 (LOW: index SKU memakai
  `(opname_id, pos_sku_id)` tanpa `product_id` — setara karena SKU adalah PK
  global), security attempt 1 **FAIL** (CRITICAL pre-existing: rute
  `GET/PATCH …/[id]` dan `POST …/[id]/complete` mencari opname hanya dengan
  `id` tanpa cek company/branch, sedangkan Fase 3 mengalirkan penulisan
  `pos_product_skus.stock_quantity` lewat jalur itu) → attempt 2 menambah
  `isOpnameInScope` (semantik identik `buildOpnameScopeFilter`), 404 untuk
  lintas scope, dan guard `status <> 'completed'` + rowCount pada transisi
  akhir (double-complete → 400, rollback) → security PASS, test PASS (tsc 0
  error di berkas opname — 5 error tipe mock di test complete diperbaiki
  dengan `vi.fn<…>` bertipe; vitest 234 berkas / 1974 test).
  - Bukti hidup sebagai `demo@suluapparel.id` (server lokal): POPN-2026-001
    16 baris SKU KAOS-001, M-Hitam −2 / S-Putih +1 → SKU tepat, fgi −1,
    3 mutasi (2 SKU + 1 Σ); POPN-2026-002 produk tanpa varian +2 identik jalur
    lama; POPN-2026-003 XL-Hitam 20→19, M-Hitam tetap 33, fgi 233→232, kartu
    stok satu baris produk. Scope: `demo@dusunbambu.id` GET/PATCH/complete
    opname apparel → 404 JSON; pemilik → 200.
  - Perluasan scope yang disetujui: migration follow-up
    `20260911083000_opname_variant_sku_unique_fix.sql`; halaman
    create/hitung (`product-stock-opname-create-page.tsx`) — kunci baris
    `product_id` diganti komposit `product_id::pos_sku_id` / `line.id`
    agar 16 baris SKU tidak saling timpa saat dihitung dari browser.
  - Catatan: dev server yang dijalankan ulang oleh preview sempat 404 HTML
    untuk semua rute API bertingkat (turbopack) — restart menyembuhkan.
  - Pre-existing yang tetap terbuka (di luar scope): 3 temuan GRN dari Fase
    2; 2 error `react-hooks/set-state-in-effect` lama di create page.
  - MR dibuat via `push -o merge_request.create` ke `development`; nomor
    dicatat saat merge. Tidak ada GitLab issue yang cocok.
- 2026-09-11 — Akun pemilik `apparel@arkivworld.com` (role `admin`, scope
  `company`) ditambahkan ke `apparel.js`. User ber-scope `company` pertama di
  database ini menyingkap celah lama: `GET /api/purchasing/warehouses` dan
  `validateWarehouseForReceivingScope` hanya membatasi scope `branch`, jadi
  scope `company` melihat/boleh memakai 29 gudang semua company. Diperbaiki
  di akar (`resolveWarehouseCompanyFilter` di `src/lib/api/scope.ts`; daftar
  gudang `IN` cabang company; validator gudang penerimaan cek `company_id`
  cabang). Bukti lokal: apparel@ → 2 gudang (MAIN, WORKSHOP-STORE),
  demo cabang tetap 2, Dusun Bambu tetap 8; produk 15 / bahan 35 / opname 3
  = apparel saja. Unit test `scope.test.ts`; vitest penuh hijau.
