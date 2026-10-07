-- =============================================================================
-- EPIC-036 Fase B — Menu Kepegawaian → Hari Libur
--
-- Halaman CRUD master hari libur (/dashboard/hris/holidays), sibling "Shift
-- Kerja" (order 30) sehingga muncul tepat di bawahnya.
--
-- Grant sengaja hanya super_admin + hrd (Acceptance Criteria EPIC-036), BUKAN
-- pola super_admin+admin seperti menu kepegawaian lain: isi tabel ini menyetir
-- potongan jatah cuti karyawan, jadi yang boleh mengubahnya dipersempit ke
-- pemilik prosesnya. Baca tetap terbuka untuk semua akun lewat API (kalender
-- ESS butuh tanggal merah), yang dibatasi di sini adalah hak tulis + menu.
--
-- Idempoten: aman dijalankan ulang.
-- =============================================================================

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('hris.kepegawaian.holidays', 'Hari Libur', '/dashboard/hris/holidays', 'calendar',
        'sidebar', 35, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'hris', level = 3 WHERE code = 'hris.kepegawaian.holidays';

UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'hris.kepegawaian.holidays' AND parent.code = 'hris.kepegawaian';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete","export","import"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'hrd') AND m.code = 'hris.kepegawaian.holidays'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
