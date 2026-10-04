-- Recruitment pipeline revamp:
-- 1. Status kandidat baru: applied, screening, psikotes, interview, offer,
--    hired, talent_pool, rejected (remap dari status lama).
-- 2. Tabel hasil analisis AI CV (recruitment.candidate_ai_analysis).
-- 3. Tabel app settings key-value (configuration.app_settings) untuk
--    menyimpan konfigurasi integrasi (mis. DeepSeek API key).

-- ── 1. Remap status lama → baru ────────────────────────────────────────
ALTER TABLE recruitment.candidates DROP CONSTRAINT IF EXISTS candidates_status_check;

UPDATE recruitment.candidates SET status = 'applied' WHERE status = 'new';
UPDATE recruitment.candidates SET status = 'interview'
WHERE status IN ('interview_hrd', 'interview_manager');

ALTER TABLE recruitment.candidates ADD CONSTRAINT candidates_status_check
  CHECK (status = ANY (ARRAY[
    'applied'::text,
    'screening'::text,
    'psikotes'::text,
    'interview'::text,
    'offer'::text,
    'hired'::text,
    'talent_pool'::text,
    'rejected'::text
  ]));

ALTER TABLE recruitment.candidates ALTER COLUMN status SET DEFAULT 'applied';

-- ── 2. Hasil analisis AI per kandidat ──────────────────────────────────
CREATE TABLE IF NOT EXISTS recruitment.candidate_ai_analysis (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  uuid NOT NULL REFERENCES recruitment.candidates(id) ON DELETE CASCADE,
  cv_text       text,
  extracted     jsonb NOT NULL DEFAULT '{}'::jsonb, -- {nama,email,no_hp,sumber,pendidikan,pengalaman}
  summary       text,
  match_score   integer CHECK (match_score BETWEEN 0 AND 100),
  match_reason  text,
  job_context   text,                               -- JD yang dipakai saat analisis
  model         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS candidate_ai_analysis_candidate_uq
  ON recruitment.candidate_ai_analysis (candidate_id);

-- ── 3. App settings (key-value) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS configuration.app_settings (
  key         text PRIMARY KEY,
  value       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
