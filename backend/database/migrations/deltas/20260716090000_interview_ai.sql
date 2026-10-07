-- EPIC-003 TG1: Interview AI — sesi interview virtual dengan AI interviewer.
--
-- 1. Sesi interview per undangan (token unik, kandidat akses tanpa login,
--    wajib on-cam). AI menanyakan hal basic (pengalaman, keahlian, motivasi,
--    ketersediaan, ekspektasi gaji) lalu menyimpulkan relevansi kandidat.
-- 2. Turn tanya-jawab: pertanyaan AI (+ audio TTS) & jawaban kandidat
--    (rekaman suara → transkrip Whisper, atau ketik).
-- 3. Event proctoring interview — superset event psikotes + deteksi wajah
--    (keluar frame / lebih dari satu wajah / kamera mati).

-- ── 1. Sesi interview ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruitment.interview_ai_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    uuid NOT NULL REFERENCES recruitment.candidates(id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent', 'in_progress', 'completed', 'expired')),
  -- interview WAJIB on-cam; kolom tetap ada utk audit consent
  webcam_consent  boolean,
  -- config: max_questions (default 8), language
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- kesimpulan AI (ringkasan, relevansi, keahlian, ekspektasi gaji, red flags)
  ai_summary      jsonb,
  summary_model   text,
  summarized_at   timestamptz,
  invited_at      timestamptz,
  expires_at      timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_ai_sessions_candidate
  ON recruitment.interview_ai_sessions (candidate_id, created_at DESC);

DROP TRIGGER IF EXISTS update_interview_ai_sessions_updated_at ON recruitment.interview_ai_sessions;
CREATE TRIGGER update_interview_ai_sessions_updated_at
  BEFORE UPDATE ON recruitment.interview_ai_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2. Turn tanya-jawab ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruitment.interview_ai_turns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL REFERENCES recruitment.interview_ai_sessions(id) ON DELETE CASCADE,
  turn_no            integer NOT NULL,
  topic              text,
  question           text NOT NULL,
  -- audio TTS pertanyaan (storage private, cache — bisa NULL bila TTS gagal)
  question_audio_path text,
  -- jawaban kandidat: rekaman suara (private) + transkrip Whisper, atau ketik
  answer_audio_path  text,
  answer_transcript  text,
  answer_mode        text CHECK (answer_mode IS NULL OR answer_mode IN ('voice', 'text')),
  transcribe_model   text,
  asked_at           timestamptz NOT NULL DEFAULT now(),
  answered_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, turn_no)
);

CREATE INDEX IF NOT EXISTS idx_interview_ai_turns_session
  ON recruitment.interview_ai_turns (session_id, turn_no);

-- ── 3. Event proctoring interview ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruitment.interview_ai_proctor_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES recruitment.interview_ai_sessions(id) ON DELETE CASCADE,
  event_type   text NOT NULL
               CHECK (event_type IN (
                 'tab_blur', 'fullscreen_exit', 'paste', 'disconnect',
                 'webcam_snapshot', 'face_not_detected', 'multiple_faces', 'camera_off'
               )),
  meta         jsonb,
  storage_path text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_ai_proctor_events_session
  ON recruitment.interview_ai_proctor_events (session_id, created_at);
