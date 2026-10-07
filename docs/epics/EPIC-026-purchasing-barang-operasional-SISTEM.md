# EPIC-026 — Sistem Purchasing Barang Operasional (Dokumentasi Teknis Holistik)

> Dokumen ini merangkum **keseluruhan sistem** modul _Purchasing Barang Operasional_
> (non-F&B, non-jual) yang dibangun di EPIC-026: arsitektur, model data, alur
> end-to-end, inventaris teknis, keputusan desain, dan status.
> Companion dari epic utama [`EPIC-026-purchasing-barang-operasional.md`](./EPIC-026-purchasing-barang-operasional.md).
>
> **Status:** TUNTAS fase A + B1–B5 + C1 → `ready-for-qa` · **Environment:** dev (PM2 port 3459)
> · **Terakhir diperbarui:** 2026-07-24

---

## 1. Ringkasan Eksekutif

Modul ini menangani **pengadaan barang operasional** — ATK, spare part, consumable
maintenance — yaitu barang yang **dibeli untuk dipakai internal**, BUKAN bahan baku
F&B dan BUKAN produk yang dijual di POS. Alur lengkapnya:

```
Master Barang → PR → Approval PR → PO → Approval PO → Penerimaan (GRN) →
    → Invoice & Pembayaran Vendor
                    ↓ (item stockable=true)
          Inventory Riil (stok per gudang) → Pemakaian / Penyesuaian
```

Keputusan arsitektural inti: **BUKAN modul baru**, melainkan perluasan modul purchasing
yang sudah ada lewat **`module_type` ketiga bernama `general`** — mesin
PR→PO→GRN→Approval→Invoice dipakai bersama tiga domain (`raw_material`, `product`,
`general`), difilter per `module_type`.

---

## 2. Konteks & Keputusan Owner

| Keputusan | Isi |
|-----------|-----|
| **Perluas, jangan bikin baru** | Reuse `src/modules/purchasing` + `src/lib/purchasing` via `module_type` ketiga `general`. |
| **Master item terpisah** | Barang operasional punya master sendiri `item.supply_items` (ber-flag `stockable`), terpisah dari `item.products` (jual) & `item.raw_materials` (F&B + BOM). |
| **Campuran stockable** | `stockable=false` → di-_expense_ saat diterima (tak ada stok); `stockable=true` → masuk inventory riil. |
| **Reuse tabel vendors** | Pemasok pakai tabel `purchasing.vendors` yang sama (seperti scope `product`). |
| **TANPA BOM / Produksi / Delivery manual** | Barang operasional tidak diproduksi & tidak butuh langkah delivery manual. |
| **Vendor pemisahan LOGIS** (24 Jul) | JANGAN pisah tabel vendor; beri penanda `usage_scope` (`fnb`/`operasional`/`keduanya`) agar dropdown PO tiap modul relevan. Backfill semua vendor lama → `keduanya`. |
| **Bangun bertahap** | Karena scope `product` ternyata = klon pipeline penuh (~40 route, rewrites, dsb), `general` dibangun bertahap B1→B5 + C1. |
| **Route TANPA rewrite** (KISS) | Semua halaman `general` di path fisik `/dashboard/items/general/*` — TIDAK pakai rewrite `next.config` (beda dari RM `/dashboard/raw-material` & product `/dashboard/product`). |

---

## 3. Arsitektur

### 3.1 Strategi `module_type`

Tabel `purchasing.purchase_requests`, `purchase_orders`, `pr_items`, `purchase_order_items`,
`grn_items` bersifat multi-domain lewat kolom `module_type` + FK item per domain. Diskriminan
item memakai **XOR 3-arah**:

```sql
-- purchase_order_items & grn_items
CHECK (num_nonnulls(raw_material_id, product_id, supply_item_id) = 1)  -- tepat satu dari tiga
```

`pr_items` lebih longgar (FK nullable, tanpa CHECK diskriminan).

### 3.2 Dua pola reuse yang berbeda

Poin arsitektur terpenting untuk memahami effort tiap fase:

| Kelompok fitur | Pola | Konsekuensi |
|----------------|------|-------------|
| **PR, PO, Receive** | **KLON** feature (`general-pr`, `general-po`, `general-receive`) meniru `product-*` | Effort besar: tiap fitur punya folder sendiri + route fisik + menu. `MODULE_TYPE` di-hardcode per-feature `api.ts`. |
| **Approval, Invoice** | **SHARED parameterized** (`approval/*`, `vendor-payments/*` terima prop `moduleType`) | Effort kecil: cukup tambah cabang 3-arah + mount halaman `moduleType="general"`. |

> Catatan: scope `product` punya klon `product-approval` & `product-invoice`, TAPI
> `general` sengaja memakai fitur **shared** langsung (lebih ramping) — bukan klon.

### 3.3 Peta layer

```
UI (route fisik /dashboard/items/general/*  →  wrapper tipis)
   └─ Feature (general-pr / general-po / general-receive / supply-items / supply-inventory
              + fitur SHARED approval & vendor-payments dgn moduleType="general")
       └─ API route (/api/purchasing/*  → cabang moduleType==="general")
           └─ lib/purchasing/* (schema Zod, module-scope, grn, supply-inventory, dst)
               └─ PostgreSQL (schema: item, purchasing, inventory, iam)
```

---

## 4. Model Data

### 4.1 Master item — `item.supply_items`

| Kolom | Tipe | Catatan |
|-------|------|---------|
| `id` | uuid PK | |
| `kode` | varchar | auto `SUP-YYYYMMDD-NNN` |
| `nama`, `deskripsi` | varchar / text | |
| `kategori` | varchar | kode kategori (denormalisasi, pola master lain) |
| `satuan_id` | uuid | FK `item.units` |
| **`stockable`** | boolean | **false = expense saat terima; true = masuk inventory** |
| `harga_beli` | numeric | harga beli terakhir/estimasi (dipakai form PR/PO) |
| `stok_minimum` | numeric | relevan hanya bila stockable |
| `company_id`, `branch_id` | uuid | scope tenant (fail-closed) |
| + audit | | `is_active`, `created_*`, `updated_*`, `deleted_*` |

Master pendukung: `item.supply_categories` (kategori, via route lookup generik).

### 4.2 Diskriminan `supply_item_id`

Kolom `supply_item_id uuid` ditambahkan ke: `pr_items`, `purchase_order_items`, `grn_items`
— sebagai FK item ketiga di samping `raw_material_id` & `product_id`.

### 4.3 Inventory riil (schema `inventory`) — C1

| Tabel | Peran |
|-------|-------|
| `inventory.supply_inventory` | Saldo stok per **(supply_item, gudang)**: `qty_available`, `qty_on_order`, `qty_minimum`, `unit_cost` (rata-rata tertimbang), scope company/branch. |
| `inventory.supply_inventory_movements` | Ledger pergerakan: tipe `in`/`out`/`adjustment`/`return`, referensi `grn`/`usage`/`adjustment`/`opname`/`return`. |

Costing = **rata-rata tertimbang** per (item, gudang), reuse `calculateWeightedAverage()`
dari `lib/purchasing/inventory.ts`. Domain-paralel:
`raw material → inventory.inventory` · `produk → finished_goods_inventory` ·
**`barang operasional → inventory.supply_inventory`**.

### 4.4 Pemakaian (usage)

| Tabel | Peran |
|-------|-------|
| `purchasing.supply_usages` | Header pemakaian barang operasional. |
| `purchasing.supply_usage_items` | Baris item yang dipakai (mengurangi stok). |

### 4.5 Vendor `usage_scope`

`purchasing.vendors.usage_scope text NOT NULL DEFAULT 'keduanya'` —
`'fnb'` | `'operasional'` | `'keduanya'`. Dropdown PO tiap modul memfilter vendor
per scope. General PO **reuse** kolom `vendor_id`/`vendor_name` (jalur vendor, seperti
product); `supplier_id` di-set NULL.

---

## 5. Alur End-to-End

### 5.1 Diagram status

```
PR (draft) ──approve──► PR (approved) ──jadi dasar──► PO (draft)
                                                          │
                                        approve ──────────┤
                                                          ▼
PO (approved) ──send──► PO (sent) ──terima──► GRN (received)
                                                  │
              ┌───────────────────────────────────┤
              ▼ (item stockable=true)              ▼ (item stockable=false)
    supply_inventory (+stok, non-fatal)       di-expense (tak ada stok)
              │
PO status ≥ approved & payable_amount>0 ──► muncul di Invoice & Pembayaran
              │
      bayar per PO ──► vendor_payments (paid/partial/unpaid)
              │
   stok terpakai ──► Pemakaian (supply_usages) / Penyesuaian (adjustment)
```

### 5.2 Karakter tiap tahap

- **PR** — form ramping, harga estimasi langsung dari `supply_items.harga_beli` (TANPA vendor-price-list), satuan dari `units`. Badge Stok/Expense per item.
- **PO** — reuse vendors; boleh PO manual (guard "PO wajib dari PR" hanya untuk `raw_material`). Prefill dari PR via `?pr_id=`.
- **Approval** — fitur shared; `POApprovalPage`/`PRApprovalPage` dengan `moduleType="general"`. Approve PR/PO memakai endpoint id-based yang module-agnostic.
- **GRN / Penerimaan** — **v1** langsung dari PO (delivery dibuat otomatis di balik layar; TANPA delivery manual & TANPA QC). Item stockable → posting stok riil (**non-fatal**: gagal-inventory tidak membatalkan penerimaan); non-stockable → di-expense.
- **Invoice & Pembayaran** — fitur shared vendor-payments; PO general muncul sebagai invoice setelah `approved` & `payable_amount>0`. Pembayaran per PO (dukung termin) → `vendor_payments`.
- **Inventory / Pemakaian / Penyesuaian** — stok riil per gudang, dengan halaman pemakaian & penyesuaian.

---

## 6. Inventaris Teknis

### 6.1 Migrasi (schema `database/migrations/deltas/`)

| File | Fase | Isi |
|------|------|-----|
| `20260723210000_purchasing_general_supply.sql` | A | `item.supply_items` + `item.supply_categories`; kolom `supply_item_id` di pr_items/po_items; XOR diskriminan 3-arah. |
| `20260723220000_purchasing_general_menu.sql` | B1 | Menu master "Barang Operasional". |
| `20260723230000_purchasing_general_pr_menu.sql` | B2 | Grup `items.general.purchasing` + sidebar PR. |
| `20260723240000_purchasing_general_po_menu.sql` | B3 | Sidebar PO. |
| `20260723250000_purchasing_general_grn.sql` | B4 | `grn_items.supply_item_id` + diskriminan 3-arah. |
| `20260723260000_purchasing_general_receive_menu.sql` | B4 | Sidebar Penerimaan Barang. |
| `20260724100000_vendor_usage_scope.sql` | C1 | `vendors.usage_scope` + backfill `keduanya`. |
| `20260724110000_supply_inventory.sql` | C1 | `inventory.supply_inventory` + `supply_inventory_movements`. |
| `20260724120000_supply_usage_and_inventory_menu.sql` | C1 | `supply_usages` + `supply_usage_items` + menu inventory. |
| `20260724130000_purchasing_general_approval_menu.sql` | B5 | Sidebar Persetujuan PR & PO. |
| `20260724140000_purchasing_general_invoice_menu.sql` | B5 | Sidebar Invoice & Pembayaran. |

> Runner: `npm run db:migrate` (dry) / `db:migrate:apply`. Ledger `public.schema_migrations`
> pakai checksum — **JANGAN edit file migrasi setelah apply**. Tiap migrasi idempoten
> (`ON CONFLICT` / `IF NOT EXISTS`), atomik, target lokal.

### 6.2 Route fisik (`src/app/dashboard/(dashboard)/items/general/`)

| Area | Route |
|------|-------|
| Master | `items/`, `categories/` |
| PR | `purchasing/pr/`, `/insert`, `/[id]`, `/edit/[id]` |
| PO | `purchasing/po/`, `/insert`, `/[id]` |
| Penerimaan | `purchasing/receive/`, `/[poId]` |
| **Approval** | `approval/pr/`, `approval/po/` |
| **Invoice** | `purchasing/invoice/` |
| Inventory | `inventory/`, `/[id]`, `/usage`, `/adjustment` |

Semua = **wrapper tipis** yang me-mount komponen feature. Approval & invoice mount fitur
shared dengan `moduleType="general"`. Konstanta rute: `GENERAL_ROUTES` di
`src/modules/purchasing/constants/item-routes.ts` (base `/dashboard/items/general`).

### 6.3 Feature (`src/features/purchasing/`)

| Folder | Peran |
|--------|-------|
| `supply-items/` | Master barang operasional (list + form + flag stockable). |
| `general-pr/` | PR barang operasional (klon `product-pr`). |
| `general-po/` | PO barang operasional (klon `product-po`, reuse vendors). |
| `general-receive/` | Penerimaan (ramping, bukan klon receiving-workspace). |
| `supply-inventory/` | Inventory riil: list/detail/usage/adjustment. |
| `approval/` (shared) | Approval PR/PO — parameter `moduleType`. |
| `vendor-payments/` (shared) | Invoice & pembayaran — parameter `moduleType`. |

### 6.4 API endpoint

| Endpoint | Peran |
|----------|-------|
| `/api/purchasing/supply-items` (+`/[id]`) | CRUD master; scope company+branch fail-closed; auto-kode. |
| `/api/purchasing/pr`, `/pr/[id]`, `/pr/form-data` | PR (cabang `module_type=general`). |
| `/api/purchasing/po`, `/po/[id]`, `/po/form-data` | PO (cabang general, reuse vendors). |
| `/api/purchasing/grn` | Penerimaan (cabang general + posting stok). |
| `/api/purchasing/pr/[id]/approve`, `/po/[id]/approve` | Approval (id-based, module-agnostic). |
| `/api/purchasing/vendor-payments`, `/po/[id]/payments`, `/po/[id]/payment-terms` | Invoice & pembayaran. |
| `/api/purchasing/inventory/supply` (+`/[id]`, `/form-data`) | Saldo stok barang operasional. |
| `/api/purchasing/inventory/supply-usage` | Pemakaian stok. |
| `/api/purchasing/inventory/supply-adjustment` | Penyesuaian stok. |

### 6.5 Lib inti

| File | Peran |
|------|-------|
| `lib/purchasing/module-scope.ts` | `PurchasingModuleType = "raw_material" \| "product" \| "general"` + `parsePurchasingModuleType`. |
| `lib/purchasing/supply-inventory.ts` | `getOrCreateSupplyInventory`, `addSupplyStockFromGrn`, posting usage/adjustment (costing rata-rata tertimbang). |
| `lib/purchasing/grn.ts` | Logika GRN (dengan cabang posting stok general di route). |
| `lib/purchasing/utils.ts` | Helper `formatRp`, `toQty`, dsb. |
| `features/purchasing/approval/approval-module.ts` | Config approval 3-arah (routes, label, party name). |

---

## 7. Pola & Keputusan Desain Kunci

1. **`module_type` ketiga, bukan modul baru** — mesin PR→PO→GRN→Approval→Invoice dipakai bersama, difilter per domain.
2. **Route TANPA rewrite `next.config`** (KISS) — URL = lokasi fisik `/dashboard/items/general/*`.
3. **Diskriminan XOR 3-arah** — `num_nonnulls(raw_material_id, product_id, supply_item_id) = 1` di po_items & grn_items.
4. **Klon untuk PR/PO/Receive, shared untuk Approval/Invoice** — effort berbeda; approval & invoice cukup cabang 3-arah + `moduleType="general"`.
5. **Vendor pemisahan logis** (`usage_scope`) — satu tabel vendor, penanda peruntukan; product & general = jalur vendor (`vendor_name`), raw_material = supplier (`nama_supplier`). Di backend vendor-payments general dikelompokkan dengan product (`moduleType !== "raw_material"`).
6. **stockable vs expense** — hanya `stockable=true` yang masuk `supply_inventory`; sisanya di-expense saat terima.
7. **GRN→stok non-fatal** — posting stok dibungkus `try/catch`; kegagalan inventory **tidak** membatalkan penerimaan.
8. **Cascade widening `PurchasingModuleType`** — saat `+ "general"` ditambahkan, union sempit duplikat `"raw_material" | "product"` di approval/returns/vendor-payments dilebarkan; net typecheck baseline dijaga.
9. **Costing rata-rata tertimbang per (item, gudang)** — reuse `calculateWeightedAverage`.
10. **Disiplin baseline typecheck** — target tiap fase: **0 error baru** vs baseline (461 → 456 pasca-merge branch bersama). `next build` di repo ini meng-abaikan type-error (`ignoreBuildErrors`), jadi **wajib** `npx tsc --noEmit` untuk verifikasi runtime-safety.

---

## 8. Perbedaan vs Scope Lain

| Aspek | `raw_material` | `product` | **`general`** |
|-------|----------------|-----------|---------------|
| Master item | `item.raw_materials` (+BOM) | `item.products` (harga jual) | `item.supply_items` (flag stockable) |
| Base URL | `/dashboard/raw-material` (rewrite) | `/dashboard/product` (rewrite) | `/dashboard/items/general` (TANPA rewrite) |
| Pemasok | `suppliers` | `vendors` | `vendors` (usage_scope) |
| Party label | Supplier | Vendor | Vendor |
| Delivery manual | Ya | Ya | **Tidak** (auto di balik layar) |
| QC penerimaan | Ya | Praktis skip | **Tidak** (v1) |
| Approval/Invoice | shared / klon | klon `product-*` | **shared** (`moduleType="general"`) |
| BOM / Produksi | Ya | Ya | **Tidak** |
| Inventory | `inventory.inventory` | `finished_goods_inventory` | `inventory.supply_inventory` |

---

## 9. Status & Fase Lanjut

**TUNTAS:** A (fondasi) · B1 (master + menu) · B2 (PR) · B3 (PO) · B4 (Penerimaan v1) ·
B5 (Approval + Invoice) · C1 (Inventory riil + Vendor usage_scope) → **ready-for-qa**.

**Fase lanjut OPSIONAL (bila diminta):**
- **QC riil item stockable** — saat ini `grn_qc_inspection_items.raw_material_id` masih `NOT NULL`; general v1 skip QC (GRN langsung posting stok tanpa QC).
- **Expense / jurnal GL** untuk item non-stockable.
- **Return / Delivery general** (di luar scope owner saat ini).

---

## 10. Riwayat Commit (branch `development`)

| Commit | Isi |
|--------|-----|
| `5ccb4ec` | Task A — fondasi module_type `general` + master supply_items + diskriminan 3-arah. |
| `7cdfb5d`, `52fac0e` | B1 — API master + UI + menu. |
| `b7c978d`, `0c0e2a4` | B2 — PR (backend + frontend). |
| `d7a450d`, `effc926` | B3 — PO (backend + frontend). |
| `1057c34` | B4 — Penerimaan/GRN v1 (auto-delivery, tanpa stok riil & QC). |
| `77c17d1` | C1 — Inventory supply riil + pemisahan logis vendor (usage_scope). |
| `b5ecaab` | B5 — Approval + Invoice (fitur shared, moduleType general). |
| `5d649ce` | Merge branch bersama (lokal +24 / remote +13, tanpa force-push). |
| `7920e84` | Resolusi tabrakan nomor epic → "Items & POS Master Stock" jadi EPIC-027. |
| `0a2a401` | Fix 3 runtime crash pasca-merge (dashboard layout + POS loyalty). |

---

## 11. Catatan Operasional

- **App dev:** PM2 `arkiv-pos-saas` → `next start -p 3459` (**production build**). Ubah kode → `npm run build` + `pm2 restart arkiv-pos-saas`.
- **Urutan build vs restart:** `pm2 restart` **setelah** `npm run build` selesai; cek `.next/BUILD_ID` ada sebelum restart (build|tail bisa menelan exit code).
- **`ignoreBuildErrors`:** build hijau ≠ runtime aman. Setelah merge/perubahan besar, jalankan `npx tsc --noEmit` dan diff error BARU vs baseline — error tipe bocor ke runtime jadi ReferenceError/undefined.
- **Push:** `git -c credential.helper='store --file=~/.git-credentials-arkiv' push origin development`.
- **Smoke non-auth:** route terproteksi balas `307` (redirect login), bukan `200` — itu normal.
