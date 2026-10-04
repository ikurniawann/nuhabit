-- EPIC-038: jumlah tamu per pesanan (pax)
--
-- Kasir mengisi berapa orang yang duduk saat memilih meja. Kalau tidak diisi,
-- dianggap 1 orang — DEFAULT ditaruh di level database, bukan hanya di UI,
-- supaya jalur lain yang membuat pesanan (seat reservation, open bill dari
-- tablet, RPC) ikut terhitung benar tanpa harus disentuh satu per satu.
--
-- Pesanan lama otomatis bernilai 1. Itu asumsi, bukan fakta historis — tapi
-- lebih berguna daripada NULL yang memaksa setiap pembacaan menangani "tidak
-- tahu", dan tidak ada sumber data untuk merekonstruksi angka sebenarnya.
--
-- Tidak ada batas atas terhadap kapasitas meja: keputusan owner 2026-07-31
-- adalah PERINGATKAN TAPI TETAP IZINKAN. Restoran nyata menambah kursi, dan
-- memblokir hanya membuat kasir mengisi angka palsu — datanya jadi lebih buruk
-- daripada tidak ada. Batas bawah tetap ditegakkan: 0 atau negatif tidak punya
-- arti untuk "berapa orang duduk".

ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS guest_count integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_orders_guest_count_positive'
  ) THEN
    ALTER TABLE pos.pos_orders
      ADD CONSTRAINT pos_orders_guest_count_positive CHECK (guest_count > 0);
  END IF;
END $$;

COMMENT ON COLUMN pos.pos_orders.guest_count IS
  'Jumlah tamu yang duduk untuk pesanan ini (pax). Default 1 bila kasir tidak mengisi. Boleh melebihi kapasitas meja — UI memperingatkan, tidak memblokir.';

-- Papan monitoring menghitung tamu yang SEDANG duduk: pesanan berstatus
-- terbuka yang punya meja. Indeks parsial ini melayani query itu tanpa
-- membebani tabel dengan indeks penuh yang jarang terpakai.
CREATE INDEX IF NOT EXISTS idx_pos_orders_meja_terbuka
  ON pos.pos_orders (table_id)
  WHERE table_id IS NOT NULL
    AND status IN ('pending', 'confirmed', 'preparing', 'ready', 'served');
