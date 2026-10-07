-- EPIC-002 TG1: Psikotes Online — fondasi data & sesi tes.
--
-- 1. Katalog instrumen (6 seed: papi_kostick, baum, dap, wartegg,
--    aritmatika, matematika). Konten soal PAPI proprietary — TIDAK di-seed,
--    diinput user via UI kelola soal (TG2).
-- 2. Bank soal per instrumen. `answer_key` HANYA boleh dibaca server-side;
--    endpoint publik kandidat (TG3) tidak boleh pernah men-select kolom ini.
-- 3. Sesi tes per undangan (token unik, kandidat mengakses tanpa login).
-- 4. Hasil per instrumen per sesi (jawaban, skor, gambar proyektif, review).
-- 5. Event proctoring (flag perilaku + snapshot webcam).
-- 6. Menu IAM `hris.recruitment.psikotes` + grant permission role existing.

-- ── 1. Katalog instrumen ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruitment.psikotes_instruments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('mcq', 'forced_choice', 'drawing')),
  -- config: duration_seconds, question_count (mcq: jumlah soal ditarik dari
  -- bank), shuffle (bool), instructions (teks utk kandidat)
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_psikotes_instruments_updated_at ON recruitment.psikotes_instruments;
CREATE TRIGGER update_psikotes_instruments_updated_at
  BEFORE UPDATE ON recruitment.psikotes_instruments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO recruitment.psikotes_instruments (code, name, kind, config, sort_order) VALUES
  ('papi_kostick', 'PAPI Kostick', 'forced_choice',
   '{"duration_seconds": 2400, "shuffle": false, "instructions": "Pilih satu pernyataan (A atau B) yang paling menggambarkan diri Anda pada setiap pasangan. Tidak ada jawaban benar atau salah."}'::jsonb, 10),
  ('baum', 'Baum (Tree Test)', 'drawing',
   '{"duration_seconds": 1200, "instructions": "Gambarlah sebuah pohon berkayu pada kertas kosong, lalu foto dan unggah hasil gambar Anda."}'::jsonb, 20),
  ('dap', 'DAP (Draw a Person)', 'drawing',
   '{"duration_seconds": 1200, "instructions": "Gambarlah seorang manusia secara utuh, lalu foto dan unggah hasil gambar Anda."}'::jsonb, 30),
  ('wartegg', 'Wartegg (WZT)', 'drawing',
   '{"duration_seconds": 1800, "instructions": "Lengkapi 8 kotak stimulus menjadi gambar yang bermakna, lalu foto dan unggah hasil gambar Anda."}'::jsonb, 40),
  ('aritmatika', 'Aritmatika', 'mcq',
   '{"duration_seconds": 600, "question_count": 10, "shuffle": true, "instructions": "Kerjakan soal hitungan berikut. Waktu berjalan otomatis dan jawaban tersimpan setiap kali Anda memilih."}'::jsonb, 50),
  ('matematika', 'Matematika', 'mcq',
   '{"duration_seconds": 600, "question_count": 10, "shuffle": true, "instructions": "Kerjakan soal matematika berikut. Waktu berjalan otomatis dan jawaban tersimpan setiap kali Anda memilih."}'::jsonb, 60)
ON CONFLICT (code) DO NOTHING;

-- ── 2. Bank soal ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruitment.psikotes_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES recruitment.psikotes_instruments(id) ON DELETE CASCADE,
  body          text NOT NULL,
  -- mcq: [{"key":"a","text":"..."}, ...]
  -- forced_choice (PAPI): {"a":{"text":"...","scale":"A"},"b":{"text":"...","scale":"G"}}
  options       jsonb,
  -- mcq: {"correct":"a"}; forced_choice: null (skor dari mapping scale di options)
  answer_key    jsonb,
  sort_order    integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_psikotes_questions_instrument
  ON recruitment.psikotes_questions (instrument_id, is_active, sort_order);

DROP TRIGGER IF EXISTS update_psikotes_questions_updated_at ON recruitment.psikotes_questions;
CREATE TRIGGER update_psikotes_questions_updated_at
  BEFORE UPDATE ON recruitment.psikotes_questions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 3. Sesi tes (1 baris = 1 undangan; battery = baris di session_tests) ─
CREATE TABLE IF NOT EXISTS recruitment.psikotes_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    uuid NOT NULL REFERENCES recruitment.candidates(id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'sent', 'in_progress', 'completed', 'expired')),
  -- null = kandidat belum menjawab consent kamera
  webcam_consent  boolean,
  invited_at      timestamptz,
  expires_at      timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_psikotes_sessions_candidate
  ON recruitment.psikotes_sessions (candidate_id, created_at DESC);

DROP TRIGGER IF EXISTS update_psikotes_sessions_updated_at ON recruitment.psikotes_sessions;
CREATE TRIGGER update_psikotes_sessions_updated_at
  BEFORE UPDATE ON recruitment.psikotes_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 4. Hasil per instrumen per sesi ────────────────────────────────────
-- status: pending → in_progress → selesai (auto-score) | perlu_review
-- (proyektif) → reviewed (setelah review manual HR).
CREATE TABLE IF NOT EXISTS recruitment.psikotes_session_tests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES recruitment.psikotes_sessions(id) ON DELETE CASCADE,
  instrument_id    uuid NOT NULL REFERENCES recruitment.psikotes_instruments(id),
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'in_progress', 'selesai', 'perlu_review', 'reviewed')),
  -- jawaban kandidat; kunci tidak pernah dikirim ke client, skor server-side
  answers          jsonb,
  score            numeric CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  -- mcq: {"correct":9,"total":10}; papi: skor per 20 skala + skala dominan
  score_detail     jsonb,
  -- path storage private utk gambar tes proyektif
  attachment_path  text,
  review_notes     text,
  reviewed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by_name text,
  sort_order       integer NOT NULL DEFAULT 0,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, instrument_id)
);

CREATE INDEX IF NOT EXISTS idx_psikotes_session_tests_session
  ON recruitment.psikotes_session_tests (session_id, sort_order);

DROP TRIGGER IF EXISTS update_psikotes_session_tests_updated_at ON recruitment.psikotes_session_tests;
CREATE TRIGGER update_psikotes_session_tests_updated_at
  BEFORE UPDATE ON recruitment.psikotes_session_tests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 5. Event proctoring ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruitment.psikotes_proctor_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES recruitment.psikotes_sessions(id) ON DELETE CASCADE,
  event_type   text NOT NULL
               CHECK (event_type IN ('tab_blur', 'fullscreen_exit', 'paste', 'disconnect', 'webcam_snapshot')),
  meta         jsonb,
  -- path storage private utk snapshot webcam
  storage_path text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_psikotes_proctor_events_session
  ON recruitment.psikotes_proctor_events (session_id, created_at);

-- ── 6. Menu IAM + permission ───────────────────────────────────────────
-- permission_context read-only, pola sama dgn menu rekrutmen lain —
-- write ditegakkan di route handler (WRITE_ROLES), bukan di grant IAM.
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('hris.recruitment.psikotes', 'Psikotes', '/dashboard/hris/psikotes', 'clipboard',
        'sidebar', 25, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name          = EXCLUDED.menu_name,
  route_path         = EXCLUDED.route_path,
  icon               = EXCLUDED.icon,
  menu_type          = EXCLUDED.menu_type,
  order_number       = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active          = true,
  is_visible         = true,
  deleted_at         = NULL,
  updated_at         = now();

UPDATE iam.menus
SET module = 'hris', level = 3
WHERE code = 'hris.recruitment.psikotes';

UPDATE iam.menus child
SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'hris.recruitment.psikotes'
  AND parent.code = 'hris.recruitment';

-- super_admin & admin: semua action (pola iam-admin-permissions.sql)
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete","approve","export","import","execute"]'::jsonb
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code = 'hris.recruitment.psikotes'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();

-- hrd & hiring_manager: action sesuai permission_context (pola iam-role-permissions.sql)
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('hrd', 'hiring_manager')
  AND m.code = 'hris.recruitment.psikotes'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
