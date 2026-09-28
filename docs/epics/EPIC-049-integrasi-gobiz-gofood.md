# EPIC-049: Integrasi GoBiz / GoFood — Order Masuk POS & KDS — `MODULE-POS`

status: ready-for-qa
environment: dev
phase: 1
priority: P1
area: Fullstack
module: `MODULE-POS`
retries: 0

## Goal

Order GoFood masuk otomatis ke POS BCD tanpa input ulang: webhook GoBiz →
`pos.gofood_orders` → (auto/manual accept) → `pos.pos_orders` (order_type
`delivery`, lunas via `gofood`) → KDS per station → "Siap diambil" dikirim
balik ke GoFood saat dapur menandai siap. Katalog GoFood disinkron dari
`pos_products` (satu sumber kebenaran menu).

## Referensi resmi (dipakai apa adanya)

Model **Direct Integration** di [GoBiz Developer Portal](https://developer.gobiz.com):
- Auth: OAuth2 `client_credentials` — [Direct Integration](https://developer.gobiz.com/docs/docs/food-integration/direct-integration/),
  scope `gofood:catalog:write gofood:catalog:read gofood:order:write gofood:order:read gofood:outlet:write promo:food_promo:read promo:food_promo:write`.
  Sandbox API `https://api.partner-sandbox.gobiz.co.id`, OAuth `https://integration-goauth.gojekapi.com/oauth2/token`;
  produksi `https://api.gobiz.co.id` (OAuth produksi **konfirmasi ke GoBiz** — contoh dokumen memakai `accounts.go-jek.com`; bisa dioverride di setting).
- Webhook: `POST /integrations/partner/v1/notification-subscriptions` `{event,url,active}` — [Order Acceptance how-to](https://developer.gobiz.com/docs/docs/food-integration/how-to/order-acceptance/);
  payload event & daftar event — [Event List](https://developer.gobiz.com/docs/api/event-list/index.html).
- Order: `PUT …/v1/orders/{type}/{id}/accepted` · `…/cancelled` (`cancel_reason_code`, `cancel_reason_description`) — [Order Acceptance API](https://developer.gobiz.com/docs/api/food-integration/order-acceptance/index.html);
  `…/food-prepared` `{country_code:"ID"}` — [Mark Food Ready](https://developer.gobiz.com/docs/api/food-integration/mark-food-ready/index.html).
- Katalog: `PUT …/v1/catalog` full replace (`menus[].menu_items[]`, `variant_categories[]`) — [Sync Menu](https://developer.gobiz.com/docs/api/food-integration/sync-menu/index.html).
- Batas terima: manual 3 menit (auto-cancel), mode auto-accept 60 dtk.

## Tasks

- [x] T-1 Migrasi `20260912130000_gobiz_gofood_integration.sql`: `pos.gofood_orders`,
      `pos.gofood_events` (event_id UNIK = idempotency), `pos.gofood_catalog_syncs`.
- [x] T-2 `src/lib/gobiz/`: `config` (setting keys `gobiz_*`, URL default/override,
      token webhook acak), `client` (token cache, accept/reject/food-prepared/catalog/
      subscribe), `catalog` (murni: pos_products → payload GoBiz, external_id = id
      produk/varian), `mapping` (murni: parse event, status machine, item → produk POS),
      `service` (proses event, auto-accept dgn klaim atomik, buat pos_orders + item,
      batal/selesai, aksi kasir, hook food-ready).
- [x] T-3 API: `POST /api/integrations/gobiz/webhook/[token]` (publik, token path,
      selalu 200 utk event yang diabaikan), `GET/PUT /api/settings/gobiz`,
      `POST /api/settings/gobiz/actions` (test · register_webhooks · sync_catalog ·
      regenerate_token), `GET /api/pos/gofood/orders`, `POST /api/pos/gofood/orders/[id]`
      (accept · reject · ready · create_pos_order).
- [x] T-4 Hook KDS: `PATCH /api/pos/orders/[id]/status` → status ready/served/completed
      → `food-prepared` ke GoFood (best-effort, error ke `last_error`).
- [x] T-5 UI: panel **GoBiz · GoFood** di Settings → Integrasi (kredensial, environment,
      auto-accept, URL webhook + salin/regenerasi, tes koneksi, daftar webhook, sinkron
      katalog, status sinkron terakhir); halaman **POS → GoFood** (`/dashboard/pos/gofood`,
      polling 5 dtk, countdown 3 menit, Terima/Tolak dgn alasan GoBiz/Siap diambil/Buat
      order POS, item tak terpetakan disorot).
- [x] T-6 IAM menu `pos.operations.gofood` (+ prune list); middleware: webhook publik.
- [x] T-7 Test: catalog (4), mapping (9), client (5), webhook route (6), middleware (+1).
- [ ] T-8 **Butuh dari owner**: daftar di GoBiz Developer Portal → App/Client ID, Client
      Secret, Partner ID, Outlet ID (sandbox dulu). Lalu: isi di Settings → Integrasi →
      Simpan → Tes koneksi → Daftarkan webhook → Sinkron katalog → uji order via API
      Simulator GoBiz → aktifkan.

## Acceptance Criteria

- Event `gofood.order.awaiting_merchant_acceptance` → baris di POS → GoFood dalam ≤5 dtk;
  Terima → GoBiz `accepted` 200 → order POS `delivery/confirmed/paid(gofood)` tampil di KDS.
- Auto-accept aktif → order diterima tanpa klik; event dobel tidak membuat dua order POS.
- Tolak → GoBiz `cancelled` dgn `cancel_reason_code`; event `gofood.order.cancelled` dari
  pelanggan → order POS `cancelled`, item KDS `cancelled`.
- KDS bump ke *ready* → GoBiz `food-prepared` terpanggil; `food_ready_at` terisi.
- Sinkron katalog mengirim seluruh produk aktif (in_stock = is_available) dgn varian
  min1/max1; item order kembali ber-`external_id` = id produk POS → terpetakan.
- Webhook token salah → 401; payload asing/dobel → 200 diabaikan.

## Keputusan

- **Token acak di path URL webhook** sebagai autentikasi (docs GoBiz tidak merinci
  algoritma `X-Go-Signature`); `X-Go-Idempotency-Key` + `event_id` disimpan.
- **Order POS dibuat saat DITERIMA**, bukan saat event masuk — supaya KDS tidak
  memasak order yang kemudian ditolak/kedaluwarsa.
- **Harga item memakai harga GoFood** (yang dibayar pelanggan), selisih
  `order_total − Σitem` dicatat sebagai `other_charges_amount` "Biaya GoFood";
  `payment_status = paid`, `payment_method_code = gofood` (enum `pos_payment_method`
  tidak diubah). Jurnal akuntansi GoFood **belum** diposting (ditunda: butuh mapping
  akun piutang GoFood/komisi).
- Item GoFood tanpa `external_id` cocok → order POS tetap dibuat dari item yang
  terpetakan, sisanya disorot merah di halaman GoFood (kasir tambah manual).
- ~~Modifier POS belum dikirim ke GoFood~~ → sejak 2026-09-28 tiap grup add-on POS
  dikirim sbg variant category bersama `mg:<group>` (min = min_selection, opsional
  = 0) dan terpetakan balik ke `pos_order_items.modifiers`.
- Harga GoFood = Harga Channel (`pos.sales_channels` markup % + pembulatan,
  `pos.pos_product_channel_prices` override); varian & add-on ikut markup.
- Foto: GoBiz menolak WebP ("invalid image type") → foto non-JPEG/PNG dikirim
  lewat konverter publik `/api/public/gofood-image/<base64url>.jpg` (sharp).
- Webhook: X-Go-Signature = HMAC-SHA256 hex raw body dgn **Relay secret**
  (docs receiving-notifications). Mode pantau default; `gobiz_signature_enforce`
  = true menolak 401 setelah terbukti cocok di sandbox.

## Automation Log

- 2026-09-12 — Epic dibuat atas permintaan owner ("coba buatkan integrasi dengan
  gobiz dulu") setelah audit: belum ada integrasi delivery apa pun; Shopee di repo =
  marketplace toko, bukan ShopeeFood. Bentuk API diambil dari developer.gobiz.com
  (bukan asumsi). T-1…T-7 selesai; gate: vitest hijau, eslint 0 error di berkas
  baru, tsc 0 error di berkas baru (5 error implicit-any lama di
  `orders/[id]/status/route.ts` sudah ada sebelum hook ditambahkan). T-8 butuh
  kredensial GoBiz dari owner — status `ready-for-qa`.
- 2026-09-28 — Kredensial sandbox owner diterima: token OAuth sandbox OK (scope
  lengkap), production 401 (memang kredensial sandbox). Outlet sandbox
  `G799456240` (outlet asli G313322705 JANGAN disinkron — menu grup cabang berisi
  bundling yang belum ada di POS; sinkron = full replace). 10 event webhook
  terdaftar ke `https://poskopi.reddie.id/api/integrations/gobiz/webhook/<token>`.
  Sinkron katalog pertama ditolak 422 karena foto WebP; uji tanpa foto DITERIMA
  (add-on min 0 valid). Ditambah: add-on ke katalog, Harga Channel, konverter
  foto JPEG, Partner ID/Relay secret + verifikasi X-Go-Signature (mode pantau).
