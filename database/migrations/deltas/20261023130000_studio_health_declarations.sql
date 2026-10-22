-- EPIC-067 T-067-C3 — PAR-Q (health declaration) di Member App → penanda medis.
--   • studio.health_declarations: isian PAR-Q member (versi pertanyaan,
--     jawaban per kode, keterangan bebas). Riwayat disimpan; yang berlaku =
--     terbaru, dianggap kedaluwarsa setelah 12 bulan (member diminta mengisi
--     ulang lewat banner, tidak memblokir booking — waiver & syarat wajib
--     tetap di EPIC-064).
--   • member_flags.source: 'staff' | 'coach' | 'parq'. Jawaban "ya" membuat
--     penanda medis source 'parq' dengan needs_review = true; coach yang
--     mengajar member itu meninjaunya di roster Coach Portal (konfirmasi →
--     reviewed_*, atau hapus). Detail medis tetap hanya untuk coach
--     (keputusan client no. 9).

CREATE TABLE IF NOT EXISTS studio.health_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  version varchar(20) NOT NULL,
  answers jsonb NOT NULL,
  has_yes boolean NOT NULL,
  details varchar(500),
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_health_declarations_customer ON studio.health_declarations (customer_id, submitted_at DESC);

ALTER TABLE studio.member_flags ADD COLUMN IF NOT EXISTS source varchar(10) NOT NULL DEFAULT 'staff';
ALTER TABLE studio.member_flags DROP CONSTRAINT IF EXISTS member_flags_source_check;
ALTER TABLE studio.member_flags ADD CONSTRAINT member_flags_source_check CHECK (source IN ('staff', 'coach', 'parq'));
UPDATE studio.member_flags SET source = 'coach' WHERE created_by_coach_id IS NOT NULL AND source = 'staff';
ALTER TABLE studio.member_flags ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE studio.member_flags ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE studio.member_flags ADD COLUMN IF NOT EXISTS reviewed_by_coach_id uuid REFERENCES studio.coaches(id) ON DELETE SET NULL;
ALTER TABLE studio.member_flags ADD COLUMN IF NOT EXISTS declaration_id uuid REFERENCES studio.health_declarations(id) ON DELETE SET NULL;
