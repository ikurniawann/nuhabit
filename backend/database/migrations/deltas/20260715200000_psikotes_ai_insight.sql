-- EPIC-002 follow-up: insight AI (DeepSeek) utk tes gambar Baum/DAP/Wartegg.
-- Disimpan sbg cache di baris tes: {observation, insight{...}, model, created_at, created_by_name}.
-- Insight bersifat indikatif utk membantu HRD — BUKAN keputusan final.

ALTER TABLE recruitment.psikotes_session_tests
  ADD COLUMN IF NOT EXISTS ai_insight jsonb;
