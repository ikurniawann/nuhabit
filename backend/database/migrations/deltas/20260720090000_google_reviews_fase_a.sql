-- EPIC-013 Fase A: Google Review — tarik ulasan & balas dari dashboard.
--
-- Ulasan BUKAN percakapan: satu ulasan hanya boleh punya SATU balasan (API
-- Google mengganti balasan lama, bukan menambah). Karena itu tabelnya berdiri
-- sendiri, bukan dipaksa masuk wa_conversations. Yang dipakai ulang adalah
-- konsepnya: komplain, SLA, dan template balasan.

CREATE TABLE IF NOT EXISTS crm.google_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nama resource penuh dari Google (accounts/../locations/../reviews/..).
  -- Unik: dasar sinkronisasi idempoten.
  review_name text NOT NULL UNIQUE,
  location_name text,
  reviewer_name text,
  reviewer_photo_url text,
  star_rating int NOT NULL,
  comment text,
  -- Waktu menurut Google, bukan waktu tarik — supaya urutan & SLA benar.
  review_created_at timestamptz NOT NULL,
  review_updated_at timestamptz,

  reply_comment text,
  reply_updated_at timestamptz,
  replied_by_user_id uuid,

  status text NOT NULL DEFAULT 'baru',
  is_complaint boolean NOT NULL DEFAULT false,
  sla_breached boolean NOT NULL DEFAULT false,
  -- Detik dari ulasan terbit sampai balasan pertama terkirim.
  first_reply_seconds int,

  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT google_reviews_rating_check CHECK (star_rating BETWEEN 1 AND 5),
  CONSTRAINT google_reviews_status_check
    CHECK (status = ANY (ARRAY['baru', 'dibalas', 'diabaikan'])),
  CONSTRAINT google_reviews_reply_len CHECK (reply_comment IS NULL OR char_length(reply_comment) <= 4000)
);

CREATE INDEX IF NOT EXISTS google_reviews_status_idx
  ON crm.google_reviews (status, review_created_at DESC);
CREATE INDEX IF NOT EXISTS google_reviews_rating_idx
  ON crm.google_reviews (star_rating, review_created_at DESC);
-- Antrean yang perlu dibalas & pengawas SLA.
CREATE INDEX IF NOT EXISTS google_reviews_pending_idx
  ON crm.google_reviews (review_created_at)
  WHERE status = 'baru';

DROP TRIGGER IF EXISTS google_reviews_set_updated_at ON crm.google_reviews;
CREATE TRIGGER google_reviews_set_updated_at
  BEFORE UPDATE ON crm.google_reviews
  FOR EACH ROW EXECUTE FUNCTION public.crm_set_updated_at();

-- Konfigurasi (value bertipe jsonb — angka/boolean literal JSON).
INSERT INTO crm.crm_settings (key, value)
SELECT seed.key, seed.value::jsonb FROM (VALUES
  -- Ulasan bintang <= nilai ini otomatis ditandai komplain.
  ('gr_complaint_max_rating', '3'),
  -- Target waktu membalas ulasan (menit). 1440 = 1 hari.
  ('gr_sla_reply_minutes', '1440'),
  ('gr_sync_enabled', 'true')
) AS seed(key, value)
WHERE NOT EXISTS (
  SELECT 1 FROM crm.crm_settings s WHERE s.key = seed.key
);
