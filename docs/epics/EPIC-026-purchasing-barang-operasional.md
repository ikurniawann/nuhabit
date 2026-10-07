# EPIC-026: Purchasing Barang Operasional (Non-F&B, Non-Jual)

status: ready-for-qa
environment: dev
retries: 0

## Goal

Menambah domain purchasing KETIGA untuk **barang operasional** — dibeli untuk
kebutuhan internal venue, BUKAN bahan baku F&B dan BUKAN barang yang dijual di
POS (mis. ATK, spare part, consumable maintenance, perlengkapan venue).

Keputusan arsitektur (owner 2026-07-23): **perluas modul purchasing yang sudah
ada lewat `module_type` ketiga — jangan bangun modul baru.** Seluruh mesin
siklus PR → PO → Receive (GRN) → Return → Invoice → Approval + manajemen
pemasok sudah teruji untuk scope `raw_material` & `product`; menambah scope
ketiga = menyalin pola yang sudah ada, bukan menulis ulang.

Barang operasional bersifat **campuran**: sebagian di-*expense* saat diterima
(ATK habis pakai), sebagian **di-stok** (spare part disimpan & dipakai
bertahap) — dibedakan per item lewat flag `stockable`.

## Evidence

- `purchasing.purchase_requests.module_type` & `purchasing.purchase_orders.module_type`
  sudah jadi diskriminator (`raw_material` | `product`) via CHECK constraint —
  migrasi template: `20260702130000_purchase_requests_module_type.sql` +
  `20260702140000_product_purchase_orders.sql`.
- `purchase_order_items` sudah pola XOR diskriminan `raw_material_id` /
  `product_id` + CHECK `purchase_order_items_item_target_check`.
- Backend sudah route-aware: `parsePurchasingModuleType()`
  (`src/lib/purchasing/module-scope.ts`) + cabang `if (moduleType === 'product')`
  di `src/app/api/purchasing/po/route.ts` (dan ±14 route purchasing lain).
- Master item terpisah per domain: `item.raw_materials` (F&B+BOM),
  `item.products` (punya `harga_jual` → katalog jual). Barang operasional tak
  cocok keduanya → butuh master sendiri.
- Pemasok: `purchasing.suppliers` (RM) & `purchasing.vendors` (product);
  `purchase_orders.supplier_id` sudah nullable + ada `vendor_id`.
- Nav/route per-scope: `PRODUCT_ROUTES` / `PRODUCT_NAV_GROUPS` di
  `src/modules/purchasing/constants/item-routes.ts` & `items-nav.ts` = template.

## Scope (task groups PR-sized)

**A. Fondasi domain + master item**
1. Nilai `module_type` ketiga: **`general`** (label UI "Barang Operasional",
   namespace route `/dashboard/general`) — konfirmasi final key/label/route di
   awal grup ini.
2. Longgarkan 2 CHECK constraint `module_type` (`purchase_requests`,
   `purchase_orders`) agar menerima `general`.
3. Master item baru `item.supply_items` (kode, nama, `unit_id`, `category_id`,
   `stockable boolean NOT NULL DEFAULT false`, `is_active`, tenant cols) +
   kategori/unit reuse pola master yang ada. `stockable=false` → di-expense saat
   terima; `true` → masuk inventory.
4. Kolom FK `supply_item_id` di `purchase_order_items` &
   `purchase_request_items`; relaksasi XOR jadi "tepat satu dari tiga".
5. Extend view `v_purchase_orders` (join supply meta) — jangan pecah scope lama.

**B. Siklus dokumen — DIPECAH BERTAHAP (temuan 23 Jul, lihat Automation Log)**

Realita: scope `product` BUKAN toggle query-param melainkan **klon pipeline
penuh** — 8 folder feature `product-*`, ~40 route fisik di
`items/product/*`, rewrites `next.config.ts`, 26 baris `iam-menus.sql` + grant,
`module_type` di-hardcode per-feature (`api.ts`). Maka `general` dibangun
bertahap (keputusan owner: irisan vertikal dulu). Cakupan akhir yang dipakai:
**PR + PO + Receive + Invoice + Approval** (TANPA Return, Delivery, Production/BOM).

- **B1 — Master barang operasional** (fondasi; harus ada barang dulu):
  master `supply_items` + `supply_categories` (kategori reuse route generik
  `/api/purchasing/items/[lookup]`), API CRUD ramping (tanpa warehouse/COGS/BOM
  ala product), feature + UI master, menetapkan pola routing/menu `general`.
- **B2 — PR general**: cabang `general` di `pr/form-data` (sumber item =
  `supply_items`) + `pr/route.ts` (filter GET + insert `supply_item_id`) +
  `pr-schemas.ts`; feature `general-pr` (clone `product-pr`, `MODULE_TYPE`),
  form `general-pr-form`, route+menu. Di sini tipe `PurchasingModuleType` &
  union sempit `returns/*/grn/*` dilebarkan ke `general`.
- **B3 — PO general**: `po/form-data` + `po/route.ts` (`generalPoSchema`,
  insert `supply_item_id`) + feature/form/route/menu; reuse tabel `vendors`.
- **B4 — Receive (GRN) general**: cabang di grn/receiving-workspace; percabangan
  stok vs expense (Task C) menyatu di sini.
- **B5 — Invoice + Approval general**: cabang invoice + approval PR/PO.

**C. Percabangan stok vs expense**
9. Receive item `stockable=false` → tandai diterima TANPA membuat pergerakan
   stok/valuasi (hook expense menyusul, lihat Non-Goals).
10. Receive item `stockable=true` → reuse pergerakan inventory yang ada.
11. Nav scope `general`: tampilkan Inventory (Stock/Opname/Adjustment/Transfer)
    hanya untuk item stockable; sembunyikan BOM/Produksi.

## Non-Goals (fase lanjut)

- Posting jurnal expense otomatis ke Finance/GL untuk item non-stok (v1 cukup
  status "diterima"; integrasi akuntansi menyusul).
- Modul aset tetap / depresiasi (capex) — barang modal keluar scope EPIC ini.
- Budgeting per departemen / cost center untuk permintaan barang operasional.
- Migrasi data historis (belum ada data barang operasional).

## Acceptance Criteria

- [ ] Bisa buat master `supply_item` dengan flag `stockable`; item operasional
      tidak muncul di katalog POS maupun daftar raw material.
- [ ] Siklus penuh PR → PO → Receive → Invoice jalan untuk `module_type=general`
      tanpa menyentuh/menghitung scope `raw_material` & `product` (filter
      `module_type` fail-safe di semua list).
- [ ] Item `stockable=false` diterima TIDAK menambah stok/valuasi; item
      `stockable=true` menambah stok lewat inventory yang ada.
- [ ] Constraint `purchase_order_items` tetap menjamin tepat satu target item
      (raw_material XOR product XOR supply).
- [ ] Approval PR/PO memakai workflow yang sama; tenant isolation fail-closed di
      semua endpoint scope `general`.
- [ ] Menu `general` tidak menampilkan BOM/Produksi; nav Inventory hanya relevan
      untuk item stockable.

## Progress B1 (master barang operasional) — SELESAI & LIVE

- **Backend** (commit `7cdfb5d`): kategori `supply-categories` via route generik
  `/api/purchasing/items/[lookup]`; item master `/api/purchasing/supply-items`
  (+`/[id]`) ramping tanpa warehouse/COGS/BOM, scope company+branch fail-closed.
- **UI + menu + routing** (commit ini): feature `src/features/purchasing/supply-items/*`
  (data layer + `SupplyItemsPage`: list + dialog buat/ubah + hapus, flag `stockable`,
  dropdown kategori & satuan); halaman kategori reuse `ItemsLookupPage`. Route fisik
  `/dashboard/items/general/{items,categories}` (langsung, TANPA rewrite next.config —
  KISS). Menu via migrasi `20260723220000_purchasing_general_menu.sql`: grup
  `items.general` "Barang Operasional" > `master` > {items, categories}, grant 9 role
  (sama dengan master product).
- **Verifikasi**: typecheck baseline (0 tambahan), migrasi menu diuji rollback lalu
  apply, build hijau (3 route baru terkompilasi), PM2 restart, smoke:
  `/api/purchasing/supply-items`=401, `/dashboard/items/general/items`=307 (bukan 404).
- **QA manusia**: login role purchasing/warehouse → menu "Barang Operasional" muncul →
  buat kategori → buat barang stockable & non-stockable → edit/hapus.
- **Lanjut B2**: PR general (cabang `general` di pr/form-data + pr/route + pr-schemas,
  feature `general-pr`, form, route/menu) — di sini `PurchasingModuleType` + union
  sempit `returns/*`,`grn/*` dilebarkan ke `general`.

## Progress B2 (PR barang operasional)

- **B2a backend SELESAI & terverifikasi** (belum deploy — belum ada UI PR general):
  - `pr-schemas.ts`: `generalPrItemSchema` (`supply_item_id`) + `generalPrWriteSchema`,
    `PrModuleType` += `general`, `parsePrWriteBody` cabang general, tipe union
    `PrWriteItem` (collapse union-of-arrays → array-of-union agar insert TS bersih),
    map error `pr_items_supply_item_id_fkey`.
  - `pr/route.ts`: GET filter += general; POST derive moduleType general + insert
    `supply_item_id`.
  - `pr/[id]/route.ts`: detail resolve `supply_item` (mirror product); PUT moduleType
    general + insert `supply_item_id`.
  - `pr/form-data/route.ts`: cabang `general` → item dari `item.supply_items`
    (key `supplies`), scope company+branch.
  - Verifikasi: typecheck baseline (0 tambahan), alur create(header+item supply)+
    filter module_type=general+detail-join diuji langsung ke Postgres (rollback).
  - CATATAN: hanya `PrModuleType` (pr-schemas) yang dilebarkan — `PurchasingModuleType`
    (module-scope) & union `returns/grn/*` TIDAK perlu disentuh di B2 (PR tak memakainya),
    jadi tak ada cascade 7-error. Union itu untuk B4/B5.
- **B2b frontend SELESAI & LIVE** (deploy dev): feature
  `src/features/purchasing/general-pr/*` (klon `product-pr`, `MODULE_TYPE="general"`,
  diskriminan item `supply_item_id`, sumber item form = `supplies`) + form ramping
  `src/components/purchasing/general-pr-form.tsx` (harga estimasi langsung dari
  `supply_items.harga_beli`, TANPA vendor price list; satuan di-resolve dari `units`
  karena form-data general tak kirim `satuan_nama`; badge Stok/Expense per item) +
  4 route fisik `/dashboard/items/general/purchasing/pr/{,,insert,[id],edit/[id]}`
  (langsung, TANPA rewrite next.config — konsisten B1) + konstanta `GENERAL_ROUTES`
  di `item-routes.ts` (subset PR + rute PO/approval untuk rujukan detail, halaman
  fisiknya menyusul B3/B5) + menu via migrasi `20260723230000_purchasing_general_pr_menu.sql`
  (grup `items.general.purchasing` > `pr`, grant 9 role sama dgn B1).
  - CATATAN reuse: `PRApprovalActions`/`PRRevisionButton` dipakai apa adanya (sama
    seperti product-pr); keduanya baru relevan setelah approval general (B5) —
    revision button masih hardcode `RM_ROUTES` (bug warisan product-pr, di luar scope B2).
  - Verifikasi: typecheck kembali ke baseline (463, 0 tambahan — 2 error klon dari
    product-pr sengaja diperbaiki di kode baru: double-invoke `submitWithAction` &
    tipe param `queryKeys.list`), build hijau (4 route baru terkompilasi), migrasi
    apply bersih (menu terverifikasi: hierarki benar, 9 grant/menu), PM2 restart,
    smoke: 4 route PR=307 (redirect login, bukan 404), form-data API general=401.
  - QA manusia: login role purchasing → menu "Barang Operasional > Purchasing >
    Permintaan Barang" → buat PR (pilih supply_item, harga auto dari master) →
    draft/ajukan → list terfilter module_type=general → detail → edit draft.

## Progress B3 (PO barang operasional)

- **B3a backend SELESAI & terverifikasi** (commit `d7a450d`): PO general jalan lewat
  route bersama, difilter `module_type=general`.
  - `po/route.ts`: `generalPoSchema` (`vendor_id` + item `supply_item_id`); moduleType
    derive general; `usesVendor = product|general` → `supplier_id=null` + `vendor_id`;
    GET filter+search `vendor_name` untuk general; POST item mapping cabang `supply_item_id`
    (num_nonnulls=1). Guard "wajib dari PR" tetap hanya untuk `raw_material` (general boleh
    PO manual, seperti product).
  - `po/form-data/route.ts`: cabang general → `vendors` (REUSE) + `supplies`
    (item.supply_items, harga_beli) + units.
  - `po/[id]/route.ts`: resolusi manual `supply_item` (pola PR B2a), param map bertipe.
  - `pr/for-po`: sudah module-type generik (`.eq("module_type", moduleType)`) → dipakai
    apa adanya untuk daftar PR general yang siap di-PO-kan.
  - Verifikasi DB rollback: insert PO general + item supply lolos, dua-target ditolak
    (CHECK `purchase_order_items_item_target_check`), `v_purchase_orders` surface
    `module_type=general` + `vendor_name`, join supply OK; typecheck 0 tambahan (463).
- **B3b frontend SELESAI & LIVE** (deploy dev): feature
  `src/features/purchasing/general-po/*` (klon `product-po`: types/api/queries/mutations/
  query-keys/index + list/detail/new) + form ramping `general-po-form.tsx` (harga default
  dari `supply_items.harga_beli`, TANPA vendor price list; satuan resolve dari `units`;
  badge Stok/Expense; dukung prefill dari PR via `?pr_id=`) + 3 route fisik
  `/dashboard/items/general/purchasing/po/{,,insert,[id]}` + `GENERAL_ROUTES` (+purchasingPo,
  approvalPo) + menu migrasi `20260723240000_purchasing_general_po_menu.sql`
  (sidebar `items.general.purchasing.po`, grant 9 role).
  - Reuse endpoint aksi PO module-agnostic: approve/cancel murni transisi status; send
    hanya menyentuh inventory bila `raw_material_id` (null utk general → aman). Detail PO
    general punya tombol Setujui/Kirim/Batalkan seperti product.
  - Verifikasi: typecheck 463 (0 tambahan), build hijau (3 route baru), migrasi apply
    bersih (menu terverifikasi), PM2 restart, smoke: 3 route PO=307 + po/form-data &
    pr/for-po general=401. **B3 (PO general) TUNTAS → siap human QA.**
  - Lanjut B4: Receive (GRN) general + percabangan stok (stockable=true) vs expense
    (stockable=false, Task C) menyatu di sini.

## Progress B4 (penerimaan/GRN barang operasional) — SELESAI & LIVE

**Keputusan owner (2 fork desain, dikonfirmasi sebelum koding):**
1. **Alur delivery** — Pipeline receive lama = PO → Delivery → GRN → QC, dan
   GRN/receiving-workspace WAJIB ada record delivery. Scope general = "TANPA
   Delivery". → **Auto-buat delivery di balik layar**: penerimaan langsung dari PO
   approved/sent; delivery dibuat otomatis di backend, user tak lihat langkah
   delivery (UX ramping, honor scope).
2. **Posting stok (Task C)** — Tidak ada tabel/movement inventory ber-key
   `supply_item_id`. → **v1 = tandai diterima saja**: SEMUA item general (stockable
   & non) hanya ditandai "diterima" TANPA pergerakan stok riil & TANPA QC. Inventory
   supply nyata + posting expense/GL = fase lanjut (selaras Non-Goals). AC
   "stockable=false tidak menambah stok" terpenuhi; AC "stockable=true menambah stok"
   DITUNDA fase lanjut.

**Backend** (reuse GRN POST bersama + cabang general):
- Migrasi `20260723250000_purchasing_general_grn.sql`: kolom `grn_items.supply_item_id`
  + FK `item.supply_items`; relaksasi `grn_items_item_target_check` →
  `num_nonnulls(raw_material_id, product_id, supply_item_id) = 1`. (deliveries & grn
  SUDAH punya `vendor_id`+`*_party_check` dari migrasi product → general reuse jalur
  vendor, tak perlu diubah.)
- `grn/route.ts`: skema `module_type += general`, item `supply_item_id`, superRefine
  1-dari-3; `delivery_id` jadi opsional + terima `po_id`. Cabang general: **auto-create
  delivery** dari PO (validasi `validatePOCanDelivery`, `vendor_id` dari PO,
  `no_surat_jalan=AUTO-<tgl>`, status pending) lalu jalur GRN yang sama. `usesVendor =
  moduleType !== raw_material` (supplier vs vendor). `grnStatus = general ? "received"
  : "pending"` (skip QC & stok). freshPoItems + qty-find + grnItems menyertakan
  `supply_item_id`. `updatePOStatusAfterGrn` module-agnostic → PO general jadi
  received/partially_received via `qty_received` (partial receive aman: delivery
  "delivered" bukan status open).
- `module-scope.ts`: `PurchasingModuleType += general` + `parsePurchasingModuleType`
  handle general. **Cascade widening** (dijadwalkan B4/B5): duplikat sempit
  `"raw_material" | "product"` dilebarkan `+ "general"` di `approval/*`,
  `returns/*`, `vendor-payments/*`, `types/purchasing.ts` (7 error TS teratasi;
  general belum benar-benar dipakai di returns tapi tipe mengalir lewat shared layer).
  Bonus: perbaiki 2 error baseline (`grn/route.ts` key `string|undefined`, `vendor_id`
  di `DeliveryForGrn`) → net **461** (turun dari 463).

**Frontend** ( RAMPING, bukan klon pipeline penuh — tak reuse receiving-workspace
delivery-centric):
- Feature `src/features/purchasing/general-receive/*` (api + 2 komponen). `api.ts`
  reuse `listGeneralPurchaseOrders`/`getGeneralPurchaseOrder` dari `general-po` +
  `listWarehouses` dari `grn`; `createGeneralGrn` POST `/grn` dengan `po_id` +
  `module_type=general`.
- `general-receive-list-page`: daftar PO general receivable (status approved/sent/
  partially_received, belum tuntas) → tombol "Terima".
- `general-receive-form-page`: muat PO detail, input qty diterima per item (default =
  sisa) + pilih gudang + catatan, badge Stok/Expense per item; submit → GRN. Riwayat
  qty_received tampil di detail PO (tak perlu halaman GRN detail terpisah di v1 →
  hindari kopling `GRNDetailPage` yang ber-rasa raw_material/QC).
- `GENERAL_ROUTES` (+`purchasingReceive`, `purchasingReceiveForm(poId)`) + 2 route
  fisik `/dashboard/items/general/purchasing/receive/{,,[poId]}` (langsung, TANPA
  rewrite) + menu migrasi `20260723260000_purchasing_general_receive_menu.sql`
  (sidebar `items.general.purchasing.receive`, grant 9 role sama B1–B3).

**Verifikasi**: typecheck 461 (0 tambahan, 2 baseline diperbaiki); build hijau (2 route
receive terkompilasi); 2 migrasi apply bersih; uji constraint DB rollback (supply-only
lolos, dual-target & zero-target ditolak `grn_items_item_target_check`, supply_item_id
column ada, menu 9 grant terverifikasi); PM2 restart; smoke: 2 route receive=307 + POST
`/api/purchasing/grn` general=401. **B4 (Receive general) TUNTAS → siap human QA.**
- **QA manusia**: buat master supply_item (stockable & non) → PR → PO → approve/kirim →
  menu "Penerimaan Barang" → PO muncul → Terima (isi qty + gudang) → PO jadi
  diterima/sebagian; item stockable & non sama-sama hanya ditandai diterima (stok tak
  berubah di v1).
- Lanjut B5: Invoice + Approval general (cabang invoice + approval PR/PO).

## Test Plan

- Typecheck + build hijau; migrasi apply bersih di dev (idempoten, pola
  `IF NOT EXISTS` seperti template).
- Uji regresi scope lama: buat 1 PO `raw_material` + 1 `product`, pastikan
  daftar & total masing-masing tak tercampur PO `general`.
- Uji percabangan stok: terima 1 item `stockable=false` (stok tetap) + 1
  `stockable=true` (stok naik) dalam 1 GRN.
- Uji constraint: coba insert `purchase_order_items` dengan dua FK item terisi →
  ditolak DB.
- Smoke: role pembeli buka `/dashboard/general/*`, alur PR→PO→Receive→Invoice.

## Automation Log

- 2026-07-23: Epic dibuat setelah analisis modul purchasing bersama owner.
  Keputusan: (a) REUSE modul via `module_type` ketiga, bukan modul baru —
  seluruh mesin PR→PO→GRN→Return→Invoice→Approval dipakai ulang; (b) barang
  operasional = campuran expense/stok → master item `supply_items` ber-flag
  `stockable`; (c) reuse tabel `vendors` untuk pemasok; (d) tanpa BOM/Produksi.
  Template implementasi = cara scope `product` ditambahkan (migrasi
  20260702130000 + 20260702140000). Implementasi belum dimulai.
- 2026-07-23: **Task Group A SELESAI** (migrasi
  `20260723210000_purchasing_general_supply.sql`, applied di dev). Isi:
  - CHECK `module_type` di `purchase_requests` & `purchase_orders` dilonggarkan
    menerima `general`.
  - Master baru `item.supply_items` (ber-flag `stockable`) + `item.supply_categories`
    (mirror `raw_material_categories`); unik per-tenant `(company_id,branch_id,kode)`.
  - Kolom `supply_item_id` + FK di `purchase_order_items` & `pr_items`.
  - Diskriminan item PO dilonggarkan `raw_material XOR product` →
    `num_nonnulls(raw_material_id, product_id, supply_item_id) = 1`. Diuji: supply
    saja lolos, dua target ditolak, nol ditolak, raw_material saja tetap lolos
    (regresi aman).
  - **Deviasi dari asumsi Scope**: (1) tabel item PR bernama `purchasing.pr_items`
    (bukan `purchase_request_items`) dan TAK punya CHECK diskriminan → cukup tambah
    kolom. (2) Master pakai konvensi asli: `kategori` varchar denormalisasi +
    `satuan_id` FK ke `item.units` (bukan `category_id`/`unit_id`). (3) View
    `v_purchase_orders` = level header (join vendor sudah ada) → TIDAK diubah.
    (4) Pelebaran tipe TS `PurchasingModuleType` ditunda ke Task B — ada union
    sempit duplikat `"raw_material"|"product"` di `src/features/purchasing/returns/*`
    yang harus dilebarkan bersamaan saat wiring feature layer (menghindari 7 error
    TS menggantung di Task A).
  - Verifikasi: migrasi apply bersih (ledger tercatat), typecheck tetap di baseline
    (463 error pre-existing, 0 tambahan). Belum ada perubahan runtime → tak perlu
    rebuild/PM2. Lanjut Task B: cabang `module_type='general'` di route
    PR/PO/GRN/Return/Invoice + route/menu `/dashboard/general`.
- 2026-07-23: **B2b (frontend PR general) SELESAI & LIVE di dev**. Feature
  `general-pr` (klon `product-pr`) + form ramping `general-pr-form` + 4 route fisik
  `/dashboard/items/general/purchasing/pr/*` + `GENERAL_ROUTES` + migrasi menu
  `20260723230000_purchasing_general_pr_menu.sql`. Detail lengkap di "Progress B2"
  di atas. Typecheck 0 tambahan, build hijau, menu terverifikasi, PM2 restart,
  smoke route+API OK. B2 (PR general) TUNTAS backend+frontend → siap human QA.
- 2026-07-23: **B3 (PO general) SELESAI & LIVE di dev** (B3a backend commit `d7a450d`
  + B3b frontend). Backend: `generalPoSchema` + cabang general di `po/route.ts`,
  `po/form-data`, `po/[id]` (reuse `vendors`, insert `supply_item_id`), verifikasi DB
  rollback. Frontend: feature `general-po` (klon `product-po`) + form ramping
  `general-po-form` (harga dari harga_beli, dukung prefill `?pr_id=`) + 3 route fisik
  `/dashboard/items/general/purchasing/po/*` + menu `20260723240000`. Detail lengkap
  di "Progress B3". Typecheck 0 tambahan, build hijau, menu terverifikasi, smoke OK.
  Lanjut B4: Receive (GRN) general + percabangan stok vs expense (Task C).
- 2026-07-24: **B4 (Receive/GRN general) SELESAI & LIVE di dev**. 2 fork desain
  dikonfirmasi owner: (1) **auto-buat delivery** di balik layar (receive langsung dari
  PO, honor scope "TANPA Delivery"); (2) **v1 tandai-diterima saja TANPA stok riil &
  TANPA QC** (inventory supply nyata = fase lanjut). Backend: migrasi
  `20260723250000` (`grn_items.supply_item_id` + diskriminan 3-arah) + cabang general
  di `grn/route.ts` (auto-create delivery dari `po_id`, `usesVendor`, status received,
  supply_item_id) + `PurchasingModuleType += general` dengan cascade widening union
  sempit di approval/returns/vendor-payments (7 error TS, dijadwalkan). Frontend: feature
  `general-receive` ramping (list PO receivable + form terima qty/gudang, badge
  Stok/Expense) + 2 route fisik + menu `20260723260000`. Detail lengkap di "Progress B4".
  Typecheck 461 (0 tambahan, 2 baseline diperbaiki), build hijau, constraint DB rollback
  OK, smoke route=307 + API=401. Siap human QA. Lanjut B5: Invoice + Approval general.
- 2026-07-24: **B5 (Approval + Invoice general) SELESAI & LIVE di dev** (commit
  `b5ecaab`). Fitur SHARED approval/vendor-payments di-cabang 3-arah + mount
  `moduleType=general` (BUKAN klon): 3 route fisik
  `/dashboard/items/general/{approval/pr,approval/po,purchasing/invoice}` + 2 migrasi
  menu. Siklus dokumen general TUNTAS: PR → PO → GRN → Approval → Invoice → Bayar.
  Detail lengkap di companion `EPIC-026-purchasing-barang-operasional-SISTEM.md`.
- 2026-07-24: **C1 (Inventory supply RIIL) SELESAI & LIVE di dev** (commit `77c17d1`,
  migrasi `20260724100000`–`20260724140000`). Tabel `inventory.supply_inventory` +
  `supply_inventory_movements` (stok per-gudang, costing rata-rata tertimbang);
  GRN → stok TERSAMBUNG (non-fatal) untuk item `stockable=true`, non-stockable tetap
  expense. API + feature `supply-inventory` + 4 halaman `/dashboard/items/general/
  inventory`. BUNDLED: vendor `usage_scope` (fnb|operasional|keduanya, backfill
  'keduanya'). Typecheck 461 (0 tambahan). Detail di companion SISTEM.
- 2026-07-24: Semua fase inti TUNTAS (A + B1–B5 + C1), ter-push ke origin
  (merge `5d649ce`) → **status epic naik ke ready-for-qa**. Fase lanjut OPSIONAL
  (bukan blocker QA): QC riil item stockable, posting expense/GL non-stockable,
  Return/Delivery general. Utang teknis kecil: `PRRevisionButton` masih hardcode
  `RM_ROUTES` (warisan klon product-pr).
- 2026-07-25: Sinkronisasi dokumen — field `status:` file ini tertinggal di `coding`
  padahal README + companion SISTEM sudah mencatat ready-for-qa; disamakan.
