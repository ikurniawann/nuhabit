-- Dataroom: akses folder per departemen (permintaan owner 2026-09-05).
--
-- Super admin mengatur folder mana yang boleh dibuka departemen mana
-- (departemen user diambil dari hris.employees.user_id → department_id).
-- Folder TANPA konfigurasi = terbuka untuk semua pengguna menu Dataroom.
-- Folder dengan konfigurasi hanya tampil/bisa dibuka oleh departemen yang
-- terdaftar; berlaku ke seluruh subfolder & file di dalamnya. Super admin
-- selalu melihat semuanya.

CREATE TABLE IF NOT EXISTS dataroom.folder_departments (
  node_id uuid NOT NULL REFERENCES dataroom.nodes(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES hris.departments(id) ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, department_id)
);
CREATE INDEX IF NOT EXISTS idx_dataroom_folder_departments_dept
  ON dataroom.folder_departments(department_id);
