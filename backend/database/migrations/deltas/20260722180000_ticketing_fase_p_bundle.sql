-- EPIC-023 Fase P: Ticket Bundling (Paket) — bundle SESAMA tiket.
-- Model: paket = ticket_product biasa (product_kind='bundle') dengan SATU
-- varian "Paket" ber-harga Regular/High sendiri, sehingga Channel Manager,
-- kalender, thumbnail, dan katalog website otomatis ikut. Komposisi paket
-- (varian komponen × qty) hidup di ticket_bundle_items; saat DIJUAL paket
-- "meledak" menjadi entitlement per orang: tiap gelang/guest menunjuk
-- varian KOMPONEN (gate & re-entry mengikuti tiket komponen) dengan
-- allocated_price hasil prorata harga paket — ledger per tiket tetap bisa
-- dibedah di laporan dan Σ alokasi per unit = harga paket (net-0 aman).

-- ============================================================
-- 1. Jenis produk: satuan vs paket
-- ============================================================
ALTER TABLE ticketing.ticket_products
  ADD COLUMN IF NOT EXISTS product_kind varchar(10) NOT NULL DEFAULT 'single'
    CHECK (product_kind IN ('single', 'bundle'));

-- ============================================================
-- 2. Komposisi paket: varian komponen × qty per 1 unit paket.
--    RESTRICT: varian yang dipakai paket tidak boleh dihapus diam-diam.
--    Larangan paket-dalam-paket dijaga di API (komponen wajib 'single').
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_bundle_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  bundle_product_id uuid NOT NULL
    REFERENCES ticketing.ticket_products(id) ON DELETE CASCADE,
  component_variant_id uuid NOT NULL
    REFERENCES ticketing.ticket_product_variants(id) ON DELETE RESTRICT,
  qty int NOT NULL CHECK (qty BETWEEN 1 AND 20),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bundle_product_id, component_variant_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_bundle_items_bundle
  ON ticketing.ticket_bundle_items (bundle_product_id);

-- ============================================================
-- 3. Jejak paket di gelang visit (walk-in): harga alokasi di-snapshot
--    saat REGISTRASI (komposisi/harga master berubah ≠ tagihan berubah);
--    gate tap men-charge allocated_price tanpa resolve matriks lagi.
--    NULL = tiket satuan (perilaku lama tak berubah).
-- ============================================================
ALTER TABLE ticketing.ticket_visit_bands
  ADD COLUMN IF NOT EXISTS bundle_product_id uuid
    REFERENCES ticketing.ticket_products(id),
  ADD COLUMN IF NOT EXISTS bundle_unit_no int,
  ADD COLUMN IF NOT EXISTS allocated_price numeric(14,2)
    CHECK (allocated_price IS NULL OR allocated_price >= 0),
  ADD COLUMN IF NOT EXISTS member_label varchar(220);

-- ============================================================
-- 4. Jejak paket di anggota booking website: guest paket menunjuk varian
--    KOMPONEN + harga alokasi; redeem memakai allocated_price (fallback
--    unit_price item utk tiket satuan) — Σ tetap = total booking (net-0).
-- ============================================================
ALTER TABLE ticketing.ticket_booking_guests
  ADD COLUMN IF NOT EXISTS bundle_product_id uuid
    REFERENCES ticketing.ticket_products(id),
  ADD COLUMN IF NOT EXISTS bundle_unit_no int,
  ADD COLUMN IF NOT EXISTS allocated_price numeric(14,2)
    CHECK (allocated_price IS NULL OR allocated_price >= 0),
  ADD COLUMN IF NOT EXISTS member_label varchar(220);
