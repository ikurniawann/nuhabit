-- EPIC-013 — multi-lokasi Google Business.
--
-- Fase A mengasumsikan SATU lokasi. Sekarang kolom `location_id` (segmen
-- setelah 'locations/' pada resource name) disimpan per ulasan supaya:
--   1. sinkronisasi bisa menarik ulasan dari BANYAK lokasi (setting
--      `google_bp_location_id` kini menerima daftar dipisah koma);
--   2. UI bisa memfilter ulasan per lokasi.
--
-- `location_name` lama tidak pernah terisi (sisa desain awal) — dibiarkan,
-- tidak dipakai.

ALTER TABLE crm.google_reviews
  ADD COLUMN IF NOT EXISTS location_id text;

-- Backfill dari resource name yang sudah tersimpan
-- (accounts/{a}/locations/{l}/reviews/{r}).
UPDATE crm.google_reviews
   SET location_id = NULLIF(substring(review_name FROM 'locations/([^/]+)'), '')
 WHERE location_id IS NULL;

CREATE INDEX IF NOT EXISTS google_reviews_location_idx
  ON crm.google_reviews (location_id, review_created_at DESC);

COMMENT ON COLUMN crm.google_reviews.location_id IS
  'Id lokasi Google (segmen setelah locations/) — dasar filter multi-lokasi.';
