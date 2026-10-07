# Handoff Progress - POS, Purchasing, Production

Tanggal: 2026-05-25 08:25 WIB

## Status Terakhir

Progress terakhir berfokus pada penyambungan Purchasing/Production ke POS, WIP end-to-end, inventory stock card, dan update README project.

## Sudah Selesai

### Inventory Stock Card
- Halaman `/dashboard/purchasing/reports/stock-card`.
- API `/api/purchasing/reports/stock-card`.
- Filter material, tipe mutasi, tanggal.
- Link dari WIP Inventory langsung membuka stock card material terkait via `material_id`.

### WIP End-to-End
- API `/api/purchasing/production/wip`.
- Section WIP Inventory di `/dashboard/purchasing/production`.
- Production output WIP masuk stok sebagai raw material type `WIP`.
- WIP bisa dipilih sebagai bahan BOM produk final.
- HPP WIP dibawa ke HPP produk final via average cost inventory.

### Production Lifecycle
- Production order detail sudah mendukung:
  - Cek ulang stok.
  - Release.
  - Start.
  - Complete.
  - Complete modal untuk actual qty dan biaya aktual.
- Complete production:
  - Mengurangi stok bahan.
  - Menambah WIP atau finished goods.
  - Menghitung HPP aktual.

### Sinkron HPP ke POS
- Helper baru `src/lib/pos/purchasing-sync.ts`.
- Production complete untuk `FINISHED_GOOD` otomatis sync HPP aktual ke `pos_products.cost_price`.
- Endpoint `/api/pos/products/sync-purchasing` memakai helper yang sama.
- POS Products menampilkan HPP di bawah harga.
- POS order item sekarang siap menyimpan snapshot:
  - `cost_price`
  - `cost_total`
  - `gross_profit`
  - `gross_margin_pct`

### Migration Sudah Di-Apply User
- `database/migrations/20260524165939_pos_order_item_cost_snapshot.sql`
- `database/migrations/20260524170835_fix_pos_order_item_cost_price_backfill.sql`

### QA Terakhir
- PostgreSQL check setelah backfill:
  - `zero_cost_with_cost_total: 0`
  - sample POS item sudah punya cost/profit/margin benar.
- Endpoint sync Purchasing ke POS berhasil untuk `QA Burger POS`.
- UI `/dashboard/pos/products` menampilkan HPP dan margin.
- Scoped lint passed untuk file POS sync/order/profit snapshot.

### README
- `README.md` sudah di-update untuk semua module utama:
  - Arkiv OS Desktop
  - HRIS
  - Recruitment
  - POS F&B
  - Table Self-Service Ordering
  - Photobooth Self-Service POS
  - CRM
  - Purchasing
  - Production/WIP/HPP/COGS
  - Inventory
  - Reporting QA
  - Master Data dan Settings

## File Penting yang Berubah

- `README.md`
- `src/lib/pos/purchasing-sync.ts`
- `src/app/api/pos/orders/route.ts`
- `src/app/api/pos/orders/open-bill/route.ts`
- `src/app/api/pos/products/sync-purchasing/route.ts`
- `src/app/api/purchasing/production/orders/[id]/route.ts`
- `src/app/api/purchasing/production/wip/route.ts`
- `src/app/api/purchasing/reports/stock-card/route.ts`
- `src/app/dashboard/(dashboard)/purchasing/production/page.tsx`
- `src/app/dashboard/(dashboard)/purchasing/reports/stock-card/page.tsx`
- `src/app/dashboard/pos/products/page.tsx`
- `database/migrations/20260524165939_pos_order_item_cost_snapshot.sql`
- `database/migrations/20260524170835_fix_pos_order_item_cost_price_backfill.sql`

## Current Git Status

Masih ada uncommitted changes. Jangan reset atau revert sembarangan.

Kategori perubahan:
- WIP Inventory dan Stock Card.
- Production complete dan HPP sync ke POS.
- POS profit snapshot.
- Notification/topbar z-index cleanup.
- README update.

## Next Task yang Disarankan

1. QA end-to-end production finished good:
   - Buat / pilih production order produk jadi.
   - Release, start, complete.
   - Cek `pos_products.cost_price` berubah sesuai HPP aktual.
   - Cek margin di `/dashboard/pos/products`.

2. QA order POS setelah migration:
   - Buat order paid atau open bill.
   - Pastikan `pos_order_items` menyimpan `cost_price`, `cost_total`, `gross_profit`, `gross_margin_pct`.

3. Buat laporan Profit POS:
   - Revenue.
   - COGS.
   - Gross profit.
   - Gross margin.
   - Breakdown per product, category, station, cashier, tanggal.

4. Setelah QA cukup, commit dan deploy.

