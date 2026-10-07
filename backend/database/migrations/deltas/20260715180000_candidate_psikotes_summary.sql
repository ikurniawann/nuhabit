-- EPIC-002 TG4: rekomendasi keseluruhan psikotes per kandidat
-- (1 baris/kandidat, upsert — pola candidate_screenings/task 7).
-- Menjadi gate tombol "Lolos → Interview" di panel Psikotes.

CREATE TABLE IF NOT EXISTS recruitment.candidate_psikotes_summary (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    uuid NOT NULL UNIQUE REFERENCES recruitment.candidates(id) ON DELETE CASCADE,
  recommendation  text CHECK (recommendation IN ('lolos', 'hold', 'tidak_lolos')),
  notes           text,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_candidate_psikotes_summary_updated_at ON recruitment.candidate_psikotes_summary;
CREATE TRIGGER update_candidate_psikotes_summary_updated_at
  BEFORE UPDATE ON recruitment.candidate_psikotes_summary
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
