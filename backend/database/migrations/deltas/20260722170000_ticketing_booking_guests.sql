-- EPIC-023 Fase D (revisi owner): rombongan bernama. Tiap unit tiket
-- dalam booking = satu "guest"; nama boleh diisi pemesan, kosong →
-- default "Ilham", "Group Ilham - 2", dst (posisi global lintas item).
-- Saat redeem D4 tiap gelang NFC di-pair ke satu guest; namanya ikut
-- tersimpan di ticket_visit_bands supaya kebaca loket & gate.

-- ============================================================
-- 1. Anggota rombongan per booking (1 baris = 1 unit tiket)
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_booking_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  booking_id uuid NOT NULL
    REFERENCES ticketing.ticket_bookings(id) ON DELETE CASCADE,
  booking_item_id uuid NOT NULL
    REFERENCES ticketing.ticket_booking_items(id) ON DELETE CASCADE,
  -- denormalisasi dari item — pairing gelang di redeem tanpa join ekstra
  variant_id uuid NOT NULL REFERENCES ticketing.ticket_product_variants(id),
  guest_name varchar(120) NOT NULL,
  -- posisi global 1..N dalam booking (1 = pemesan) — dasar penomoran default
  position integer NOT NULL CHECK (position > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, position)
);

CREATE INDEX IF NOT EXISTS idx_ticket_booking_guests_booking
  ON ticketing.ticket_booking_guests (booking_id);

-- ============================================================
-- 2. Nama anggota menempel ke gelang saat redeem (NULL utk walk-in)
-- ============================================================
ALTER TABLE ticketing.ticket_visit_bands
  ADD COLUMN IF NOT EXISTS guest_name varchar(120);

-- ============================================================
-- 3. Backfill booking hidup (menunggu-bayar/terbayar) yang dibuat
--    sebelum fitur ini — tanpa guest, redeem akan buntu.
-- ============================================================
INSERT INTO ticketing.ticket_booking_guests
  (company_id, branch_id, booking_id, booking_item_id, variant_id,
   guest_name, position)
SELECT
  b.company_id, b.branch_id, b.id, i.id, i.variant_id,
  CASE WHEN u.pos = 1 THEN b.customer_name
       ELSE 'Group ' || b.customer_name || ' - ' || u.pos END,
  u.pos
FROM ticketing.ticket_bookings b
JOIN LATERAL (
  SELECT i.id, i.variant_id,
         row_number() OVER (ORDER BY i.created_at, i.id, gs.n) AS pos
  FROM ticketing.ticket_booking_items i
  CROSS JOIN LATERAL generate_series(1, i.qty) AS gs(n)
  WHERE i.booking_id = b.id
) u ON true
JOIN ticketing.ticket_booking_items i ON i.id = u.id
WHERE b.status IN ('menunggu-bayar', 'terbayar')
  AND NOT EXISTS (
    SELECT 1 FROM ticketing.ticket_booking_guests g WHERE g.booking_id = b.id
  );
