-- Grup menu HRIS → Kepegawaian: menaungi Karyawan (/dashboard/employees)
-- dan Kontrak (/dashboard/hris/contracts) sebagai submenu.
-- Kode di-rename IN-PLACE (hris.users → hris.kepegawaian.users, dst.) agar
-- id baris & role_menu_permissions tetap utuh; seeder memakai kode baru.

-- ── 1. Grup Kepegawaian ────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('hris.kepegawaian', 'Kepegawaian', NULL, 'users', 'group', 8, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name    = EXCLUDED.menu_name,
  menu_type    = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number,
  is_active    = true,
  is_visible   = true,
  deleted_at   = NULL,
  updated_at   = now();

UPDATE iam.menus SET module = 'hris', level = 2 WHERE code = 'hris.kepegawaian';

UPDATE iam.menus child
SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'hris.kepegawaian'
  AND parent.code = 'hris';

-- ── 2. Pindahkan Karyawan & Kontrak ke bawah grup ──────────────────────
-- Idempoten: rename hanya bila kode tujuan belum ada; bila sudah ada
-- (migrasi pernah dijalankan manual) baris kode lama yang muncul lagi
-- (mis. dibuat ulang seeder/migrasi lain) di-soft-delete agar tidak dobel.
UPDATE iam.menus
SET code = 'hris.kepegawaian.users', level = 3, order_number = 10, updated_at = now()
WHERE code = 'hris.users' AND deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM iam.menus WHERE code = 'hris.kepegawaian.users');

UPDATE iam.menus
SET code = 'hris.kepegawaian.contracts', level = 3, order_number = 20, updated_at = now()
WHERE code = 'hris.contracts' AND deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM iam.menus WHERE code = 'hris.kepegawaian.contracts');

UPDATE iam.menus stray
SET deleted_at = now(), is_active = false, is_visible = false, updated_at = now()
WHERE stray.code IN ('hris.users', 'hris.contracts')
  AND stray.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM iam.menus renamed
    WHERE renamed.code = 'hris.kepegawaian.' || split_part(stray.code, '.', 2)
  );

UPDATE iam.menus child
SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code IN ('hris.kepegawaian.users', 'hris.kepegawaian.contracts')
  AND parent.code = 'hris.kepegawaian';

-- ── 3. Permission grup (pola grup HRIS lain) ───────────────────────────
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete","approve","export","import","execute"]'::jsonb
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code = 'hris.kepegawaian'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code = 'hrd'
  AND m.code = 'hris.kepegawaian'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
