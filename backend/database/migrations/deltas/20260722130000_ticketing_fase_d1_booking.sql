-- EPIC-023 Fase D1: Website Booking (public, Xendit prepaid) — skema.
-- Booking dibuat dari halaman publik /booking/[slug]: pilih tanggal →
-- harga kanal website (resolver v2) di-SNAPSHOT ke items → bayar invoice
-- Xendit → webhook menandai terbayar → redeem di loket jadi visit prepaid.
-- Kuota harian TIDAK ikut MVP (keputusan 2026-07-22); blok-online per
-- tanggal (R1) adalah rem manualnya. Menu dashboard "Booking" menyusul D5.

-- ============================================================
-- 1. Booking (header) — satu baris per pemesanan online
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  -- Kode pendek human-friendly utk loket (BK-XXXXXX, charset anti-ambigu)
  booking_code varchar(12) NOT NULL,
  -- Capability token utk halaman status publik (64 hex) — pola /api/files:
  -- yang memegang token boleh melihat; tanpa token 404 generik.
  access_token varchar(64) NOT NULL,
  visit_date date NOT NULL,
  customer_name varchar(120) NOT NULL,
  customer_phone varchar(25) NOT NULL,
  status varchar(15) NOT NULL DEFAULT 'menunggu-bayar'
    CHECK (status IN
      ('menunggu-bayar', 'terbayar', 'digunakan', 'kedaluwarsa', 'dibatalkan')),
  -- Snapshot total saat booking dibuat (master berubah ≠ booking berubah)
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  xendit_invoice_id varchar(80),
  xendit_invoice_url text,
  paid_at timestamptz,
  expires_at timestamptz,
  used_at timestamptz,
  -- Diisi saat redeem loket (Fase D4) — booking → visit prepaid
  visit_id uuid REFERENCES ticketing.ticket_visits(id),
  -- Refund MVP = catatan manual (uang dikembalikan di luar sistem)
  refund_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, booking_code),
  UNIQUE (access_token),
  UNIQUE (xendit_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_bookings_venue_date
  ON ticketing.ticket_bookings (branch_id, visit_date, status);
CREATE INDEX IF NOT EXISTS idx_ticket_bookings_expiry
  ON ticketing.ticket_bookings (expires_at)
  WHERE status = 'menunggu-bayar';

-- ============================================================
-- 2. Booking items — snapshot harga per varian (kanal website)
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_booking_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  booking_id uuid NOT NULL
    REFERENCES ticketing.ticket_bookings(id) ON DELETE CASCADE,
  ticket_product_id uuid NOT NULL REFERENCES ticketing.ticket_products(id),
  variant_id uuid NOT NULL REFERENCES ticketing.ticket_product_variants(id),
  -- Snapshot label — nama produk/varian boleh berubah di master
  product_name varchar(150) NOT NULL,
  variant_name varchar(60) NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  season_kind varchar(10) NOT NULL CHECK (season_kind IN ('regular', 'high')),
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_booking_items_booking
  ON ticketing.ticket_booking_items (booking_id);

-- ============================================================
-- 3. Slug venue utk URL publik /booking/[slug] — tanpa bocor id internal
-- ============================================================
ALTER TABLE ticketing.ticket_settings
  ADD COLUMN IF NOT EXISTS booking_slug varchar(50);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_settings_booking_slug
  ON ticketing.ticket_settings (booking_slug)
  WHERE booking_slug IS NOT NULL;
