-- EPIC-023 — pengakuan revenue booking online (keputusan owner 2026-07-23):
-- uang booking terbayar = titipan (pendapatan diterima di muka), BARU jadi
-- revenue saat redeem. Booking yang tidak pernah datang → status `hangus`
-- setelah melewati masa berlaku (visit_date + booking_forfeit_days), dan
-- nilainya diakui sebagai pendapatan hangus di tanggal hangusnya.
-- booking_forfeit_days configurable per venue (SOP menentukan); NULL =
-- kebijakan belum diisi → tidak ada yang dihanguskan (perilaku lama).

-- Masa berlaku redeem: 0 = hanya hari-H, N = hari-H s/d H+N.
ALTER TABLE ticketing.ticket_settings
  ADD COLUMN IF NOT EXISTS booking_forfeit_days integer
  CHECK (booking_forfeit_days IS NULL
         OR (booking_forfeit_days >= 0 AND booking_forfeit_days <= 365));

COMMENT ON COLUMN ticketing.ticket_settings.booking_forfeit_days IS
  'Masa berlaku redeem booking terbayar: hari-H + N hari. Lewat itu → hangus. NULL = kebijakan belum diisi, tidak menghanguskan.';

-- Status baru `hangus` + jejak kapan dihanguskan (tanggal pengakuan
-- pendapatan hangus di laporan).
ALTER TABLE ticketing.ticket_bookings
  DROP CONSTRAINT IF EXISTS ticket_bookings_status_check;
ALTER TABLE ticketing.ticket_bookings
  ADD CONSTRAINT ticket_bookings_status_check CHECK (status IN
    ('menunggu-bayar', 'terbayar', 'digunakan', 'kedaluwarsa',
     'dibatalkan', 'hangus'));

ALTER TABLE ticketing.ticket_bookings
  ADD COLUMN IF NOT EXISTS forfeited_at timestamptz;

COMMENT ON COLUMN ticketing.ticket_bookings.forfeited_at IS
  'Kapan booking dihanguskan (status hangus) — tanggal pengakuan pendapatan hangus.';
