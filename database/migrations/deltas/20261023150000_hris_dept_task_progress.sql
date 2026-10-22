-- Task Departemen di Nuhabit — progress management & pemantauan per departemen
-- (permintaan client 2026-10-22, EPIC-068).
--   • Menu hris.performance.dept-tasks dihidupkan lagi (sempat disembunyikan di
--     20261002150000_nuhabit_prune_irrelevant_menus). Hak akses seperti aslinya:
--     semua role; halaman & API yang menyaring aksi (anggota mengerjakan,
--     atasan mengelola & mereview, HRD melihat semua departemen).
--   • Status kemunculan 'in_progress' ("Sedang dikerjakan") + progress_percent:
--     dari sub-task berbobot bila ada, atau diisi penanggung jawab (0–99%).
--     KPI task_completion tidak berubah (tetap approved ÷ jatuh tempo).
--   • hris.department_task_updates: catatan progres per kemunculan (riwayat).

UPDATE iam.menus
SET is_active = true, is_visible = true, deleted_at = NULL, updated_at = now()
WHERE code = 'hris.performance.dept-tasks';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, m.permission_context->'actions'
FROM iam.roles r CROSS JOIN iam.menus m
WHERE m.code = 'hris.performance.dept-tasks' AND r.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

ALTER TABLE hris.department_task_occurrences ADD COLUMN IF NOT EXISTS progress_percent smallint
  CHECK (progress_percent BETWEEN 0 AND 100);
ALTER TABLE hris.department_task_occurrences ADD COLUMN IF NOT EXISTS started_at timestamptz;

CREATE TABLE IF NOT EXISTS hris.department_task_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES hris.department_task_occurrences(id) ON DELETE CASCADE,
  note varchar(500),
  progress_percent smallint CHECK (progress_percent BETWEEN 0 AND 100),
  author_employee_id uuid REFERENCES hris.employees(id) ON DELETE SET NULL,
  author_name varchar(120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_dept_task_updates_occ ON hris.department_task_updates (occurrence_id, created_at DESC);
