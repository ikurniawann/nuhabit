-- =============================================================================
-- Nuhabit — sembunyikan menu warisan BCD Coffee yang tidak relevan untuk venue
-- Hyrox (lihat docs/product/PRD.md §3). Soft-delete (deleted_at) supaya data
-- dan route tetap ada; menu bisa dihidupkan lagi lewat migrasi bila dibutuhkan.
--
-- Pola prefix: menghapus `code` itu sendiri + seluruh turunannya (`code.%`).
-- Seeder canonical `database/seeders/iam-menus.sql` ikut dibersihkan agar
-- `db:seed:iam-menus` tidak menghidupkan kembali menu ini.
-- =============================================================================

WITH pruned(prefix) AS (
  VALUES
    -- Modul utuh yang tidak dipakai venue Hyrox
    ('resort'),                              -- akomodasi & front office hotel
    ('shop'),                                -- toko online & marketplace
    ('sales-funnel'),                        -- pipeline penjualan B2B
    ('dataroom'),                            -- berbagi berkas
    ('settings.shipping'),                   -- ongkir toko online
    -- HRIS: rekrutmen & logbook harian outlet
    ('hris.recruitment'),
    ('hris.performance.logbook'),
    ('hris.performance.logbook-list'),
    ('hris.performance.dept-tasks'),
    -- Items: produksi in-house (roasting / central kitchen)
    ('items.product.production'),
    ('items.raw-material.production'),
    ('items.reports.production-in-house'),
    -- POS: operasional restoran & dapur
    ('pos.kitchen.kds'),
    ('pos.kitchen.queue-board'),
    ('pos.operations.gofood'),
    ('pos.operations.restaurant'),
    ('pos.operations.tables'),
    ('pos.operations.reservation'),
    -- Gamifikasi BCD (ARK Coin & XP, avatar, badge, wallpaper)
    ('pos.loyalty.settings'),
    ('crm.badges'),
    ('crm.wallpapers'),
    ('crm.loyalty.avatars'),
    -- Accounting: invoice grosir B2B kopi
    ('accounting.receivable.invoices-b2b')
)
UPDATE iam.menus m
SET is_active = false,
    is_visible = false,
    deleted_at = now(),
    updated_at = now()
FROM pruned p
WHERE m.deleted_at IS NULL
  AND (m.code = p.prefix OR m.code LIKE p.prefix || '.%');
