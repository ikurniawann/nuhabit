# EPIC-039: Merchandise & E-commerce — Storefront Online, Kurir, Xendit & Omnichannel Shopee

status: ready-for-qa
environment: dev
retries: 0

## Goal

Menjual **merchandise** (kaos, topi, souvenir, dll.) lewat dua kanal:
kasir POS yang sudah ada dan **website e-commerce publik** baru — dengan
satu master produk & satu sumber kebenaran stok. Termasuk tiga integrasi
pihak ketiga:

1. **Modul kurir** — cek ongkir, buat pengiriman, resi & tracking.
2. **Payment gateway Xendit** — checkout online (reuse integrasi booking).
3. **Omnichannel marketplace** — sinkron stok & tarik pesanan,
   **prioritas Shopee** (Tokopedia/TikTok Shop menyusul lewat pola adapter).

Keputusan arsitektur inti (hasil audit skema 2026-08-02): merchandise
**BUKAN** jalur F&B (tanpa BOM/resep) dan **BUKAN** module_type purchasing
baru — reuse jalur `module_type='product'` + `item.products` yang memang
untuk barang beli-jadi-jual.

## Fondasi yang sudah ada (audit 2026-08-02)

1. **Purchasing 3 arah sudah siap** — `purchase_requests.module_type` /
   `purchase_orders.module_type` CHECK `('raw_material','product','general')`;
   XOR di `purchase_order_items` (`num_nonnulls(raw_material_id, product_id,
   supply_item_id) = 1`). Merchandise dibeli via jalur `product` →
   `item.products`. TIDAK perlu module_type keempat.
2. **`pos_products.product_kind`** varchar(20) CHECK `('regular','gift_card')`
   (delta `20260727100000`) — preseden diskriminator yang tinggal ditambah
   nilai `merchandise`. JANGAN pakai kolom `station` (nilai `merchandise`
   di sana ada, tapi semantiknya routing dapur/bar).
3. **Kategori hierarkis** — `pos.pos_categories` (`parent_id` self-FK,
   `display_order`) sudah cukup; buat cabang "Merchandise" + sub-kategori.
4. **Stok flat POS** — `pos_products.inventory_quantity` /
   `inventory_min_stock` + `pos_inventory_settings` (allow_negative,
   threshold) untuk produk non-resep.
5. **Seam purchasing→POS yang harus ditutup** — sinkronisasi sekarang hanya
   soft via SKU string `PUR-<kode>` (`src/lib/pos/purchasing-sync.ts`).
   Kolom `source_product_id` disebut di docs EPIC-027 tapi **belum pernah
   dimigrasikan** — epic ini yang mewujudkannya.
6. **Pola channel distribution ticketing** — `ticket_channels` +
   `ticket_product_channels` (`is_distributed`, UNIQUE produk×channel) +
   harga per channel — pola yang ditiru untuk katalog online merchandise.
7. **Xendit sudah live di booking** — invoice + webhook
   (`src/app/api/public/booking/[slug]/webhook/xendit`), pola prefix
   invoice per konteks + branch webhook + kirim WA setelah paid
   (`sendXxxPaidWa`). Checkout merchandise reuse pola ini persis.
8. **Surface publik ber-slug** — `(public)/booking/[slug]`, `(public)/pass`,
   `buildPublicCatalog` / `resolvePublicVenue` di
   `src/lib/ticketing/booking-server.ts` — preseden scoping storefront
   per venue/slug (catatan: `pos_products` TIDAK punya company/branch id).
9. **WA gateway mandiri** (services/wa-gateway) — notifikasi pesanan
   (paid, dikirim + resi) tinggal pakai.
10. **Engine promo EPIC-032 & gift card EPIC-034** — kandidat dipakai di
    checkout online pada fase lanjut (bukan MVP).

## Usulan Arsitektur

### Sisi produk (extend, bukan tabel baru)

```
pos_products.product_kind += 'merchandise'
pos_products.source_product_id  → item.products (FK baru, nullable)
pos_products: weight_gram, length_cm, width_cm, height_cm (utk ongkir),
              long_description (storefront)
pos_product_images             — multi-foto (product_id, url, display_order)
pos_product_skus               — varian ber-stok sendiri (BARU, khusus
                                 merchandise): product_id, sku UNIQUE,
                                 nama varian (mis. "Merah / L"),
                                 opsi (jsonb {warna, ukuran}), barcode,
                                 price_override NULL, stock_quantity,
                                 is_active
```

Aturan stok: produk merchandise TANPA varian pakai
`pos_products.inventory_quantity` (perilaku lama); produk BER-varian
stoknya per baris `pos_product_skus` (stok produk = SUM sku). Satu pool
stok dipakai bersama kasir + web + marketplace.

### Sisi e-commerce (schema baru `shop`)

```
shop.channels            — kasir | web | shopee | (tokopedia, tiktok nanti)
shop.storefronts         — toko online ber-slug, cakupan CONFIGURABLE
                           (keputusan owner): venue_ids NULL = gabungan
                           semua venue, atau berisi 1+ venue = toko
                           satuan; satu instance boleh punya beberapa
                           storefront sekaligus
shop.product_channels    — product_id × channel_id, is_distributed,
                           price_override NULL (pola ticket_product_channels)
shop.orders              — order online: nomor (prefix baru), customer
                           (nama/WA/email, link pos_customers — terisi
                           otomatis bila login member),
                           alamat kirim, subtotal, ongkir, total, status
                           (pending|paid|packing|shipped|completed|
                           cancelled|refund), payment ref (xendit),
                           shipping ref (kurir), source_channel
shop.order_items         — order_id, product_id, sku_id NULL, qty, harga
                           snapshot, nama snapshot
shop.stock_reservations  — tahan stok saat checkout (order pending, TTL)
                           supaya tidak oversell antar kanal
```

### Modul kurir (schema `shipping` / bagian `shop`)

```
shop.shipments — order_id, provider (agregator), courier_code+service,
                 biaya, resi (waybill), status (pending|pickup|in_transit|
                 delivered|failed), tracking_history jsonb, webhook events
```

Integrasi lewat **Biteship** (keputusan owner 2026-08-02) — satu API →
banyak kurir (JNE, J&T, SiCepat, AnterAja, Gojek/Grab instan): rates +
create order + pickup + tracking webhook. Kredensial via env
(`BITESHIP_API_KEY`), JANGAN hardcode.

### Omnichannel Shopee (schema `shop`, pola adapter)

```
shop.marketplace_accounts   — channel_id, shop_id, token OAuth (encrypted),
                              expires, status koneksi
shop.marketplace_links      — mapping item Shopee (item_id/model_id) ↔
                              product_id/sku_id lokal, UNIQUE dua arah
shop.marketplace_sync_log   — audit push stok / pull order / error
```

- **Shopee Open Platform** (open.shopee.com): daftar partner app → shop
  authorization (OAuth, token refresh) → API `product` (baca listing),
  `update_stock` (push stok), `order` (pull pesanan), `logistics`
  (opsional AWB).
- Arah sinkron MVP: **stok = push dari Arkiv → Shopee** (Arkiv master);
  **pesanan = pull Shopee → Arkiv** (cron polling + push webhook bila
  tersedia) → buat `shop.orders` source_channel=shopee → potong stok →
  push stok terbaru ke channel lain.
- Pembayaran & kurir pesanan Shopee DIURUS SHOPEE — modul kurir & Xendit
  TIDAK dipakai untuk order marketplace; Arkiv hanya sinkron stok,
  status, dan (opsional) cetak AWB.
- Kode adapter: `src/lib/shop/marketplace/{types.ts,shopee.ts}` — interface
  generik (auth, pushStock, pullOrders, ackOrder) supaya Tokopedia/TikTok
  Shop tinggal menambah adapter.

### Anti-oversell (kunci desain lintas kanal)

- Semua mutasi stok lewat satu fungsi `adjustMerchStock()` ber-`FOR UPDATE`
  (pola tab/gift-card yang sudah terbukti) + movement log.
- Checkout web: reservasi stok saat buat invoice Xendit (TTL = masa
  berlaku invoice); release saat expired/cancel; commit saat paid.
- Setiap commit stok → antrikan push stok ke Shopee (debounce); penjualan
  kasir juga memicu push.
- Buffer stok per channel (mis. Shopee tampil stok − N) sebagai
  pengaman — **CONFIGURABLE di settings** (keputusan owner), default 0
  (tanpa buffer) + interval rekonsiliasi configurable.

## Fase

### Fase A — Merchandise di Kasir POS (fondasi)
- Migrasi: `product_kind += 'merchandise'`, `source_product_id` FK →
  `item.products`, kolom berat/dimensi + long_description.
- UI master produk POS: pilihan jenis "Merchandise", tautkan ke master
  purchasing (`item.products`) — GRN purchasing `product` menambah stok
  POS otomatis (ganti soft-sync SKU string).
- Kategori: seed cabang "Merchandise" di `pos_categories`.
- Kasir jual merchandise = produk regular (potong stok langsung, tanpa BOM).

### Fase B — Varian ber-SKU & Aset Storefront
- Tabel `pos_product_skus` + `pos_product_images` + UI kelola varian
  (matrix warna×ukuran), barcode per SKU, stok per SKU.
- Kasir: pilih varian saat jual (scan barcode SKU langsung pilih varian).
- Stock opname / koreksi stok per SKU.

### Fase C — Modul Kurir (backend duluan — checkout butuh ongkir)
- Integrasi agregator (keputusan OQ-1): klien API di
  `src/lib/shop/shipping/`, endpoint cek tarif (origin = alamat venue,
  destinasi + berat dari keranjang).
- `shop.shipments` + create order kirim + webhook tracking → update status.
- Settings admin: alamat origin per venue, kurir yang diaktifkan, markup
  ongkir opsional.

### Fase D — Storefront Publik + Checkout Xendit + Login Member
- Schema `shop` (channels, storefronts, product_channels, orders,
  order_items, stock_reservations) + halaman `(public)/shop/[slug]` :
  katalog (hanya produk `is_distributed` channel web), detail produk +
  varian, keranjang. Slug = `shop.storefronts` — cakupan satuan per
  venue ATAU gabungan, configurable (keputusan owner).
- **Login member (keputusan owner: sejak awal, bukan fase lanjut)** —
  reuse auth portal member EPIC-011 (member.within.ventures / OTP WA);
  guest checkout tetap boleh. Bila login: order tertaut `pos_customers`,
  **XP + ARK Coin earn** dari belanja online lewat modul bersama
  `lib/crm/collectibles.ts` (XP kanonik = `pos_customers.total_xp` —
  wajib jalur bersama, jangan tulis langsung).
- Checkout: data penerima → pilih kurir (tarif live Biteship dari Fase C)
  → invoice Xendit (prefix baru, reuse pola booking) → webhook paid →
  order `paid`, commit reservasi stok, award XP/coin bila member,
  WA konfirmasi.

### Fase E — Manajemen Pesanan Online (back-office)
- Halaman `/dashboard/shop/orders`: pipeline pending→paid→packing→
  shipped→completed (+ cancelled/refund), detail order, cetak label,
  request pickup kurir, input/lihat resi, tracking timeline.
- Notifikasi WA: paid (konfirmasi), shipped (resi), completed.
- Pembatalan & refund: release stok + catat (refund manual via dashboard
  Xendit di MVP → OQ-5).

### Fase F — Omnichannel Shopee
- `marketplace_accounts` + OAuth flow Shopee (connect di Settings),
  token refresh terjadwal.
- Mapping produk: tarik listing Shopee → tautkan ke product/sku lokal
  (UI mapping, deteksi otomatis via SKU).
- Push stok (event-driven + rekonsiliasi cron) & pull order → potong
  stok → tampil di pipeline pesanan (badge Shopee, tanpa kurir/Xendit).
- Sync log + alarm mismatch stok.

## Acceptance Criteria (ringkas per fase)

- **A**: GRN purchasing `product` menaikkan stok POS produk tertaut tanpa
  langkah manual; kasir bisa jual merchandise & stok berkurang.
- **B**: produk ber-varian menolak jual varian stok 0 (kecuali
  allow_negative); scan barcode SKU memilih varian yang benar.
- **C**: cek tarif mengembalikan ≥2 kurir dengan harga; webhook tracking
  mengubah status shipment.
- **D**: order online hanya `paid` setelah webhook Xendit valid; stok
  ter-reserve saat pending dan release saat invoice expired; dua checkout
  bersamaan tidak bisa oversell stok terakhir.
- **E**: perubahan status pesanan mengirim WA sesuai template; cancel
  mengembalikan stok.
- **F**: penjualan kasir mengubah stok listing Shopee (≤ interval sync);
  order Shopee masuk pipeline & memotong stok lokal sekali (idempoten —
  order yang sama tidak dobel potong).

## Test Plan

- Unit: kalkulasi stok varian, reservasi (create/commit/release/TTL),
  adapter Shopee (mock API), signature webhook Xendit & kurir.
- Integrasi: GRN→stok POS, checkout end-to-end (mock Xendit), pull order
  Shopee idempoten, race dua checkout stok=1 (harus satu gagal).
- E2E: alur beli dari storefront sampai resi; alur kasir jual varian.
- Keamanan: webhook tanpa signature ditolak; katalog publik tidak bocor
  produk non-distributed; token Shopee terenkripsi & tidak pernah di-log.

## Keputusan Owner (2026-08-02 — semua OQ terjawab)

- **OQ-1 Kurir**: **Biteship** + **RajaOngkir/Komerce** (tambahan owner
  2 Agu saat Fase C): dua provider lewat pola adapter, dipilih dari
  Settings → Pengiriman. Biteship = tarif + buat pengiriman + tracking;
  RajaOngkir = tarif + lacak resi (tanpa buat pengiriman → resi manual).
- **OQ-2 Storefront**: **bisa satuan per venue DAN bisa gabungan** —
  cakupan configurable per storefront (tabel `shop.storefronts`,
  `venue_ids` NULL = gabungan semua).
- **OQ-3 Pelanggan**: **login member sejak awal** supaya XP & ARK Coin
  tetap jalan (reuse portal member EPIC-011); guest checkout tetap
  tersedia sebagai jalur tanpa akun.
- **OQ-4 Buffer stok marketplace**: owner belum punya angka pasti →
  **dibuat configurable** di settings (default 0, bisa diubah per
  channel) + interval rekonsiliasi configurable.
- **OQ-5 Refund**: **manual saja** via dashboard Xendit; sistem hanya
  mencatat status refund + release stok.
- **OQ-6 Promo/gift card di web**: **fase selanjutnya**, bukan MVP
  storefront.

## Automation Log

- 2026-08-02 — Permintaan owner pasca-QA awal: menu induk sidebar di-rename
  "Toko Online" → **"Ecommerce"** (delta `20260802233000`; kode menu tetap
  `shop`, route/permission/anak tidak berubah).

- 2026-08-02 — **Fase F diimplementasikan** (coding) — omnichannel Shopee:
  - Delta `20260802230000_shop_marketplace_shopee.sql`:
    `shop.marketplace_accounts` (token OAuth per toko — disimpan plain
    mengikuti preseden configuration.payment_gateways.secret_key;
    hardening enkripsi = fase lanjut; `stock_buffer` configurable per
    akun default 0 sesuai keputusan owner), `marketplace_links` (UNIQUE
    dua arah: listing↔produk/SKU per akun), `marketplace_sync_log`,
    kolom `shop.orders.source_channel` + `marketplace_order_sn` UNIQUE
    (idempoten impor), menu Toko Online → Marketplace.
  - Adapter `src/lib/shop/marketplace/` ber-interface generik
    (Tokopedia/TikTok tinggal menambah adapter): `shopee.ts` = Open
    Platform v2 (sign HMAC-SHA256 partner, auth_partner, token
    get/refresh otomatis <10 mnt, get_item_list/base_info/model_list,
    update_stock, get_order_list/detail). Env: SHOPEE_PARTNER_ID,
    SHOPEE_PARTNER_KEY, SHOPEE_API_BASE (sandbox tersedia).
  - `sync.ts`: pushAllStock (stok riil − buffer, catat last_pushed) &
    pullMarketplaceOrders (sejak last_pull −15 mnt overlap; order
    READY_TO_SHIP/PROCESSED/SHIPPED/COMPLETED → shop.orders source
    'shopee' + klaim stok via fungsi Fase A/B; stok kurang/mapping
    hilang → order TETAP diimpor + catatan rekonsiliasi + sync_log
    error — barang sudah terjual di Shopee, kebenaran ada di sana).
    Urutan sync: pull dulu (potong stok) baru push (stok terbaru).
  - API `/api/shop/marketplace/{accounts,connect,callback,listings,
    links,sync}` — sync juga bisa dipanggil cron eksternal via header
    `x-sync-token` = env MARKETPLACE_SYNC_TOKEN (penjadwalan di deploy:
    PM2 cron / GitLab schedule, di luar scope kode).
  - UI /dashboard/shop/marketplace: hubungkan toko (OAuth), buffer per
    akun, muat listing, mapping dropdown listing↔produk/SKU, tabel
    mapping + stok terpush, tombol Sync dengan ringkasan hasil.
  - Catatan QA: butuh akun Shopee Open Platform (partner_id + key,
    sandbox test-stable tersedia) — tanpa env, endpoint menolak rapi
    503. Pembayaran & kurir order Shopee diurus Shopee (tidak menyentuh
    Xendit/modul kurir).

- 2026-08-02 — **Fase E diimplementasikan** (coding) — back-office pesanan
  + pengiriman:
  - Delta `20260802210000_shop_shipments_orders_menu.sql`:
    `shop.shipments` (provider biteship|rajaongkir|manual, provider_order_id,
    waybill, tracking_history jsonb; UNIQUE partial satu pengiriman aktif
    per order) + menu induk `shop` "Toko Online" + `shop.orders` "Pesanan"
    (/dashboard/shop/orders, role super_admin/admin).
  - API back-office: GET `/api/shop/orders` (filter status/cari, join
    shipment aktif, release reservasi expired opportunistik), GET/PATCH
    `/api/shop/orders/[id]` (transisi ketat paid→packing,
    shipped→completed, cancel utk pending/paid/packing — cancel
    mengembalikan stok held & committed + catatan "refund manual via
    Xendit" sesuai keputusan owner), POST `/api/shop/orders/[id]/shipment`
    dua mode: `provider` (Biteship createShipment; waybill bisa menyusul)
    dan `manual` (input resi — jalur RajaOngkir/kurir lain).
  - Webhook `/api/public/shop/webhook/biteship`: amankan via
    `?token=BITESHIP_WEBHOOK_TOKEN` (tanpa env → 503, tidak pernah
    terbuka); mapping status Biteship → shipment; resi baru → order
    shipped + WA resi (idempoten via guard waybill IS NULL); delivered →
    order completed.
  - WA `sendShopOrderShippedWa` (resi + link status).
  - UI /dashboard/shop/orders: tab status, tabel + badge MEMBER, dialog
    detail (item, alamat, ongkir, catatan), aksi per status (Tandai
    Dikemas / Buat Pengiriman provider / Input resi manual / Tandai
    Selesai / Batalkan ber-konfirmasi).
  - Gate: typecheck 475 = baseline; migrasi applied (menu terverifikasi).
    QA pengiriman provider butuh BITESHIP_API_KEY + daftarkan webhook
    Biteship ke URL + token.

- 2026-08-02 — **Fase D diimplementasikan** (coding) — storefront publik +
  checkout Xendit:
  - Delta `20260802190000_shop_storefront_orders.sql`: `shop.storefronts`
    (slug, venue_ids NULL=gabungan — keputusan owner satuan/gabungan,
    seed 'toko'), `shop.channels` (kasir/web/shopee), `shop.product_channels`
    (pola ticket_product_channels), `shop.orders` (+access_token pola
    booking, nomor SHOP-YYMMDD-NNNNN) + `order_items` +
    `stock_reservations` ber-TTL; fungsi `shop.release_expired_reservations()`
    (FOR UPDATE SKIP LOCKED, restore stok via fungsi Fase A/B, order
    pending ikut cancelled) — dipanggil opportunistik dari katalog &
    checkout, TANPA cron.
  - Reservasi stok = klaim-dulu (reuse fungsi stok kasir) + baris TTL =
    masa berlaku invoice Xendit (2 jam), jadi anti-oversell lintas kanal
    konsisten dengan kasir.
  - API publik `/api/public/shop/[slug]/{catalog,shipping/areas,
    shipping/rates,checkout}` + `/api/public/shop/order/[token]` +
    webhook `/api/public/shop/webhook/xendit` — semua rate-limited;
    harga & berat TIDAK dipercaya dari klien (dihitung ulang server);
    ongkir otoritatif dari provider saat checkout (klien hanya memilih
    kurir); webhook: verifikasi x-callback-token + cek silang nominal +
    idempoten (UPDATE WHERE status='pending'), prefix `shop-order-`.
  - Kebijakan XP: XP hanya utk pembayaran ARK Coin (EPIC-011,
    XP_ELIGIBLE_PAYMENT_METHOD) — order Xendit MENAUTKAN member by nomor
    WA + syncPosCustomerOrderStats (kunjungan/belanja), TANPA XP.
    → OQ BARU utk owner: apakah belanja online Xendit harus dapat XP?
    (butuh perubahan kebijakan CRM, bukan sekadar kode.)
  - Storefront `(public)/shop/[slug]`: katalog grid, dialog varian,
    keranjang localStorage, checkout (area autocomplete + ongkir live +
    pilih kurir) → redirect invoice Xendit; halaman status
    `(public)/shop/order/[token]` ber-polling saat pending.
  - Master produk: checkbox "Tampilkan di toko online" (upsert
    product_channels web) di dialog Pengaturan Merchandise; listing embed
    channels.
  - Fix bug Fase C: `db.from('shipping_settings')` tanpa schema jatuh ke
    public — kini `from('shipping_settings','shop')`.
  - Gate: typecheck 475 = baseline; migrasi applied; smoke: reservasi
    expired → released + stok balik + order cancelled; nomor order OK.
    QA end-to-end butuh XENDIT (mock XENDIT_MOCK=1 tersedia utk dev) +
    key kurir; webhook Xendit perlu didaftarkan ke URL
    `/api/public/shop/webhook/xendit` (terpisah dari webhook booking).

- 2026-08-02 — **Fase C diimplementasikan** (coding) — modul kurir DUA
  provider (permintaan owner: "buatkan juga untuk RajaOngkir"):
  - `src/lib/shop/shipping/` — interface `ShippingProvider` ber-
    `capabilities` + adapter `biteship.ts` (api.biteship.com: maps/areas,
    rates/couriers, orders, trackings) dan `rajaongkir.ts` (Komerce
    rajaongkir.komerce.id: domestic-destination, calculate/domestic-cost,
    track/waybill; `createShipment` melempar error jelas). Key via env
    `BITESHIP_API_KEY` / `RAJAONGKIR_API_KEY` — TIDAK di DB.
  - Delta `20260802170000_shop_shipping_settings.sql`: schema `shop` +
    `shop.shipping_settings` (provider aktif, origin dua kolom id karena
    sistem area beda: origin_area_id Biteship / origin_district_id
    RajaOngkir, label+kontak+alamat, kurir csv, markup flat) + menu
    `settings.shipping` (pola settings.billing, role super_admin/admin).
  - API `/api/shop/shipping/{settings,areas,rates,track}` — rates memakai
    origin+kurir+markup dari settings, filter price>0, balikan
    total_price = tarif + markup.
  - UI Settings → Pengiriman: pilih provider, kontak/alamat origin,
    pencarian area (debounce, sesuai provider), toggle 8 kurir, markup,
    panel Uji Cek Tarif.
  - `shop.shipments` + webhook tracking Biteship DIGESER ke Fase E —
    butuh `shop.orders` (Fase D) untuk ditautkan; keputusan dicatat agar
    tidak dianggap terlewat.
  - Gate: typecheck 475 = baseline; migrasi applied (baris settings
    terbuat otomatis saat GET pertama; menu terdaftar). QA live butuh
    API key di env (Biteship test key / RajaOngkir Komerce key).

- 2026-08-02 — **Fase B diimplementasikan** (coding):
  - Delta `20260802150000_pos_merchandise_skus.sql`: tabel
    `pos_product_skus` (kode SKU unik ci, barcode unik, options jsonb,
    price_override, stok per varian) + `pos_product_images` (utk
    storefront Fase D) + `pos_order_items.sku_id` (FK SET NULL);
    fungsi `pos_sell_merchandise_sku_stock` (klaim/restore per SKU,
    guard allow_negative dari setting PRODUK induk); fungsi product-level
    kini menolak `variant_required` bila produk punya SKU aktif; GRN
    receive MELEWATI produk ber-varian (stok varian masuk via koreksi
    di master — GRN per varian = fase lanjut).
  - Klaim kasir per (product,sku); `sku_id` mengalir kasir → order item;
    restore cancel/void per SKU via kolom sku_id.
  - API `/api/pos/products/[id]/skus` (+`/[skuId]`) CRUD varian; listing
    produk menyertakan embed `skus` (FK di-cache per proses oleh
    query-builder — restart dev server setelah migrasi).
  - Master produk: dialog Pengaturan Merchandise memuat editor varian
    (nama, kode SKU, barcode, stok/koreksi, harga override, aktif);
    stok produk ber-varian tampil = SUM stok SKU, kolom stok produk
    dinonaktifkan.
  - Kasir: produk merchandise ber-SKU membuka dialog Pilih Varian
    (stok per varian, badge merah stok ≤0 — server yang menolak sesuai
    allow_negative); scan/ketik barcode atau kode SKU persis di kolom
    cari langsung menambahkan varian ke keranjang; harga varian =
    override ?? harga produk; id keranjang komposit per SKU.
  - Gate: typecheck 475 = baseline (0 baru); smoke SQL lulus
    (variant_required utk product-level, jual 3→1, blocked saat
    allow_negative=false, restore →3, receive ber-varian 0 baris).

- 2026-08-02 — **Fase A diimplementasikan** (coding):
  - Delta `20260802100000_pos_merchandise_foundation.sql`: product_kind
    += 'merchandise'; FK `source_product_id` → item.products + UNIQUE
    partial (satu item purchasing ↔ satu produk POS, cegah posting GRN
    dobel); kolom berat/dimensi/long_description; fungsi
    `pos_receive_merchandise_stock` (increment atomik dari GRN) &
    `pos_sell_merchandise_stock` (klaim atomik ber-guard
    allow_negative_stock; qty negatif = restore); seed kategori
    Merchandise.
  - GRN (`api/purchasing/grn`): moduleType='product' → posting stok POS
    non-fatal (pola general EPIC-026 C1). Temuan penting: jalur product
    sebelumnya TIDAK posting stok ke mana pun; QC hanya raw_material.
  - Kasir (`api/pos/orders`): klaim stok merchandise SEBELUM order
    dibuat (pola klaim-dulu gift card), kompensasi restore di semua
    jalur gagal (orderErr/tab/gift/ark/itemsErr/catch); item merchandise
    ditandai `inventory_deducted=true`; restore saat cancel/void di
    3 route ([id] PATCH, [id]/status, [id]/void) idempoten via flag.
    Temuan: jalur order JS tidak pernah memanggil RPC `pos_create_order`
    lama — deduksi BOM F&B pun tidak berjalan di jalur live (di luar
    scope epic ini, layak epic audit stok F&B tersendiri).
  - Split bill: merchandise ber-stok DITOLAK (RPC split lama tak kenal
    deduksi merch) — pola gift card, MVP.
  - API produk (`api/pos/products` POST/PATCH): field product_kind/
    source_product_id/inventory_*/berat-dimensi via
    `lib/pos/merchandise-fields.ts`; fallback legacy 42703 ikut drop
    kolom merch.
  - UI master produk: kolom Jenis (Regular/Merchandise; Gift Card
    read-only), dialog Pengaturan Merchandise (tautan item.products via
    /api/purchasing/products, stok, berat gram).
  - Gate: typecheck 475 = baseline 475 (0 error baru); build produksi
    hijau (BUILD_ID diverifikasi); migrasi diterapkan ke DB lokal
    (termasuk 5 delta pending lama — delta grants 20260727152000 butuh
    `GRANT arkiv TO arkiv_local` sekali, sudah dijalankan); smoke test
    SQL lulus: jual 5→2, default boleh minus, settings
    allow_negative=false → insufficient_stock, restore qty negatif,
    receive via source_product_id 0→7 (rows=1), kategori Merchandise
    ter-seed. Catatan: item.products lokal kosong — QA GRN butuh master
    item dulu.

- 2026-08-02 — Semua 6 OQ dijawab owner: Biteship; storefront satuan
  ATAU gabungan (configurable via `shop.storefronts.venue_ids`); login
  member sejak awal (XP+ARK Coin via `lib/crm/collectibles.ts`, guest
  tetap boleh); buffer stok marketplace configurable default 0; refund
  manual; promo/gift card di web ditunda ke fase lanjut. Epic siap
  di-set `on-progress` kapan pun mau mulai Fase A.
- 2026-08-02 — Epic dibuat dari sesi brainstorming + audit skema
  (pos_products/product_kind, purchasing module_type 3-arah, pola
  channel ticketing, Xendit booking). Keputusan arsitektur: merchandise
  = `product_kind` baru di `pos_products` + purchasing reuse jalur
  `module_type='product'`; TANPA BOM; nomor epic 039 karena 038 sudah
  terpakai commit "jumlah tamu" (belum ada file epic-nya).
