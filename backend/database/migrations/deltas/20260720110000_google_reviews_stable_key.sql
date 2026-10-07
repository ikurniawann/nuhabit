-- EPIC-013 Fase A — kunci ulasan dibuat tahan ganti akun Google.
--
-- Sebelumnya ulasan dikunci pada `review_name` yang berbentuk
-- accounts/{A}/locations/{L}/reviews/{R}. Nama itu MEMUAT id akun, sehingga
-- kalau kredensial dipindah ke akun Google lain (atau lokasi di-reparent),
-- ulasan yang sama datang dengan nama berbeda dan tersimpan sebagai baris
-- baru — riwayat balasan lama jadi terputus dan daftar tampak dobel.
--
-- Kunci dipindah ke `review_id` (segmen terakhir) yang stabil lintas akun.
-- `review_name` tetap disimpan karena dibutuhkan saat memanggil API balasan,
-- dan akan selalu disegarkan tiap sinkronisasi.

ALTER TABLE crm.google_reviews
  ADD COLUMN IF NOT EXISTS review_id text;

-- Backfill: ambil segmen setelah '/reviews/'; kalau formatnya bukan resource
-- path, pakai nilai apa adanya.
UPDATE crm.google_reviews
   SET review_id = COALESCE(
         NULLIF(regexp_replace(review_name, '^.*/reviews/', ''), ''),
         review_name
       )
 WHERE review_id IS NULL;

-- Baris yang menunjuk ulasan sama (id sama) disatukan: sisakan yang terbaru.
DELETE FROM crm.google_reviews a
 USING crm.google_reviews b
 WHERE a.review_id = b.review_id
   AND a.ctid < b.ctid;

ALTER TABLE crm.google_reviews ALTER COLUMN review_id SET NOT NULL;

ALTER TABLE crm.google_reviews
  DROP CONSTRAINT IF EXISTS google_reviews_review_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS google_reviews_review_id_uniq
  ON crm.google_reviews (review_id);

COMMENT ON COLUMN crm.google_reviews.review_id IS
  'Id ulasan Google (segmen terakhir resource name) — stabil walau akun/lokasi berganti. Ini kunci dedup.';
COMMENT ON COLUMN crm.google_reviews.review_name IS
  'Resource path penuh untuk memanggil API balasan; disegarkan tiap sinkronisasi karena memuat id akun.';
