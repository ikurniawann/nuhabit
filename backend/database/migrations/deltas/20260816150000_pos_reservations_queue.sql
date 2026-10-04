-- Nomor antrian reservasi/waiting list + kolom timestamp status.
--
-- Dua masalah sekaligus (owner 2026-08-16):
-- 1. Tombol Seat di halaman Reservation SELALU gagal "Unknown error" —
--    route PATCH menulis seated_at/completed_at/cancelled_at yang tidak
--    pernah ada di tabel.
-- 2. Reservasi (termasuk walk-in menunggu meja) kini mendapat nomor
--    antrian per tanggal (W-xx) untuk dicetak & dikirim via WA.

ALTER TABLE pos.pos_reservations ADD COLUMN IF NOT EXISTS seated_at TIMESTAMPTZ;
ALTER TABLE pos.pos_reservations ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE pos.pos_reservations ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE pos.pos_reservations ADD COLUMN IF NOT EXISTS queue_number INT;

-- Backfill baris lama: urut per tanggal berdasar created_at.
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY reservation_date::date ORDER BY created_at, id
         ) AS rn
  FROM pos.pos_reservations
  WHERE queue_number IS NULL
)
UPDATE pos.pos_reservations r
SET queue_number = numbered.rn
FROM numbered
WHERE r.id = numbered.id;

-- Satu nomor per tanggal — alokasi ber-advisory-lock di API; index ini
-- pagar terakhir kalau ada balapan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_reservations_date_queue
  ON pos.pos_reservations ((reservation_date::date), queue_number)
  WHERE queue_number IS NOT NULL;
