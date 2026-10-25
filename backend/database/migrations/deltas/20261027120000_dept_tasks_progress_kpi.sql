-- =============================================================================
-- Task Departemen: progress, pemantauan dan to-do per KPI (EPIC-068 dari
-- fork klien, 2026-10-22, plus MOM item 13). Satu model: hris.department_tasks
-- (task, rutin atau sekali jalan) dan hris.department_task_occurrences
-- (kemunculan per tanggal). Delta ini menambah:
--   • status kemunculan 'in_progress' + progress_percent (dari sub-task
--     berbobot bila ada, atau 0–99% yang diisi penanggung jawab) + started_at;
--   • hris.department_task_updates: riwayat per kemunculan (catatan progres,
--     komentar, perubahan status, review, lampiran);
--   • prioritas, tautan indikator KPI dan kontribusi yang diharapkan, zona
--     waktu, dan penanda review_required pada task; task pribadi (dibuat
--     karyawan untuk dirinya) tidak perlu review Head Division;
--   • lampiran per kemunculan (file di STORAGE_DIR/private/dept-tasks/...);
--   • kontribusi KPI yang dicatat saat kemunculan disetujui; scorecard
--     menampilkannya sebagai konteks, perhitungan snapshot tidak berubah;
--   • menu tasks (Tugas Saya), tasks.team (Papan Tim), tasks.kpi (KPI & Tugas).
-- Task rutin dijadwalkan sejak tanggal dibuat (zona task), bukan awal bulan,
-- supaya task baru tidak langsung punya kemunculan "terlambat" yang masuk KPI.
-- Idempotent.
-- =============================================================================

-- 1. Kemunculan: status in_progress, progres, mulai ----------------------------
ALTER TABLE hris.department_task_occurrences
  ADD COLUMN IF NOT EXISTS progress_percent smallint CHECK (progress_percent BETWEEN 0 AND 100);
ALTER TABLE hris.department_task_occurrences
  ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE hris.department_task_occurrences
  DROP CONSTRAINT IF EXISTS department_task_occurrences_status_check;
ALTER TABLE hris.department_task_occurrences
  ADD CONSTRAINT department_task_occurrences_status_check
  CHECK (status IN ('pending', 'in_progress', 'done', 'approved', 'rejected'));
CREATE INDEX IF NOT EXISTS idx_dept_task_occ_open
  ON hris.department_task_occurrences (occurrence_date)
  WHERE status IN ('pending', 'in_progress', 'rejected');

-- 2. Riwayat per kemunculan ----------------------------------------------------
CREATE TABLE IF NOT EXISTS hris.department_task_updates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id      uuid NOT NULL REFERENCES hris.department_task_occurrences(id) ON DELETE CASCADE,
  -- progress: catatan/persen dari penanggung jawab; comment: komentar bebas;
  -- status: mulai/selesai/buka lagi; review: setuju/tolak; attachment; created.
  kind               text NOT NULL DEFAULT 'progress'
                     CHECK (kind IN ('progress', 'comment', 'status', 'review', 'attachment', 'created')),
  note               varchar(2000),
  progress_percent   smallint CHECK (progress_percent BETWEEN 0 AND 100),
  author_employee_id uuid REFERENCES hris.employees(id) ON DELETE SET NULL,
  author_user_id     uuid,
  author_name        varchar(120),
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_dept_task_updates_occ
  ON hris.department_task_updates (occurrence_id, created_at DESC);

-- 3. Task: prioritas, KPI, zona, review ---------------------------------------
ALTER TABLE hris.department_tasks
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
ALTER TABLE hris.department_tasks
  DROP CONSTRAINT IF EXISTS department_tasks_priority_check;
ALTER TABLE hris.department_tasks
  ADD CONSTRAINT department_tasks_priority_check
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE hris.department_tasks
  ADD COLUMN IF NOT EXISTS kpi_indicator_id uuid REFERENCES performance.kpi_indicators(id) ON DELETE SET NULL;
ALTER TABLE hris.department_tasks
  ADD COLUMN IF NOT EXISTS kpi_contribution numeric(15,4);
-- Zona IANA tempat tanggal task dibaca (cabang akun pembuat).
ALTER TABLE hris.department_tasks
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Jakarta';
-- false untuk task pribadi: "selesai" langsung disetujui tanpa review.
ALTER TABLE hris.department_tasks
  ADD COLUMN IF NOT EXISTS review_required boolean NOT NULL DEFAULT true;
-- Akun pembuat (created_by menyimpan id karyawan), untuk hak daftar sendiri.
ALTER TABLE hris.department_tasks
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid;
CREATE INDEX IF NOT EXISTS idx_department_tasks_kpi
  ON hris.department_tasks (kpi_indicator_id) WHERE kpi_indicator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_department_tasks_assignee
  ON hris.department_tasks (assignee_employee_id) WHERE is_active;

-- 4. Lampiran per kemunculan ---------------------------------------------------
CREATE TABLE IF NOT EXISTS hris.department_task_attachments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id       uuid NOT NULL REFERENCES hris.department_task_occurrences(id) ON DELETE CASCADE,
  name                varchar(255) NOT NULL,
  mime                varchar(150) NOT NULL,
  size_bytes          bigint NOT NULL DEFAULT 0,
  storage_path        text NOT NULL,
  uploaded_by_user_id uuid,
  uploaded_by_name    varchar(120) NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dept_task_attachments_occ
  ON hris.department_task_attachments (occurrence_id, created_at);

-- 5. Kontribusi KPI dari kemunculan yang disetujui ----------------------------
CREATE TABLE IF NOT EXISTS hris.department_task_kpi_contributions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id  uuid NOT NULL UNIQUE REFERENCES hris.department_task_occurrences(id) ON DELETE CASCADE,
  indicator_id   uuid NOT NULL REFERENCES performance.kpi_indicators(id) ON DELETE CASCADE,
  department_id  uuid,
  employee_id    uuid REFERENCES hris.employees(id) ON DELETE SET NULL,
  period_year    integer NOT NULL,
  period_month   integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  amount         numeric(15,4),
  recorded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dept_task_kpi_contrib_period
  ON hris.department_task_kpi_contributions (indicator_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_dept_task_kpi_contrib_employee
  ON hris.department_task_kpi_contributions (employee_id, period_year, period_month);

-- 6. Menu: Tugas Saya, Papan Tim, KPI & Tugas ----------------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('tasks', 'Tugas Saya', '/dashboard/tasks', 'clipboard-document-check', 'sidebar', 4, '{"actions":["read","create","update"]}'::jsonb),
  ('tasks.team', 'Papan Tim', '/dashboard/tasks/team', 'users', 'sidebar', 10, '{"actions":["read","create","update","delete","assign"]}'::jsonb),
  ('tasks.kpi', 'KPI & Tugas', '/dashboard/tasks/kpi', 'chart', 'sidebar', 20, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'tasks', level = 1, parent_id = NULL WHERE code = 'tasks';
UPDATE iam.menus SET module = 'tasks', level = 2 WHERE code IN ('tasks.team', 'tasks.kpi');
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code IN ('tasks.team', 'tasks.kpi') AND parent.code = 'tasks';

-- super_admin dan admin: semua aksi pada ketiga menu.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('super_admin', 'admin') AND m.code IN ('tasks', 'tasks.team', 'tasks.kpi')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- Role lain mengelola daftarnya sendiri. Kepala departemen (karyawan dengan
-- bawahan langsung aktif) melihat papan departemennya lewat cek modul,
-- tanpa grant terpisah.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update"]'::jsonb
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.is_active AND r.deleted_at IS NULL
   AND r.code NOT IN ('super_admin', 'admin') AND m.code = 'tasks'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
