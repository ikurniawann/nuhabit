-- Catatan internal HR (timeline) + jejak aktivitas kandidat.
-- Kode FE (candidate-detail & pipeline) sudah lama mengharapkan kedua tabel
-- ini tapi tabelnya belum pernah dibuat — error selama ini tertelan try/catch.
-- created_by_name didenormalisasi supaya timeline bisa menampilkan penulis
-- tanpa join ke auth.users.

CREATE TABLE IF NOT EXISTS recruitment.candidate_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    uuid NOT NULL REFERENCES recruitment.candidates(id) ON DELETE CASCADE,
  content         text NOT NULL,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_notes_candidate
  ON recruitment.candidate_notes (candidate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recruitment.candidate_activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    uuid NOT NULL REFERENCES recruitment.candidates(id) ON DELETE CASCADE,
  activity_type   text NOT NULL,
  description     text NOT NULL,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_activities_candidate
  ON recruitment.candidate_activities (candidate_id, created_at DESC);
