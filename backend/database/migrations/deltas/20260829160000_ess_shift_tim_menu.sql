-- Menu ESS → Shift Tim (/dashboard/me/shift-tim): supervisor / kepala divisi
-- mengatur jadwal shift anggota timnya sendiri (bawahan langsung menurut
-- employees.reporting_to) — bukan hanya HRD (permintaan owner 2026-08-29).
-- Di-grant ke SEMUA role (pola ess_menu_semua_role): API-nya menyaring
-- bawahan, karyawan tanpa bawahan melihat penjelasan, bukan data orang lain.

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('ess.team-shifts', 'Shift Tim', '/dashboard/me/shift-tim', 'calendar-days', 'sidebar', 45,
        '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'ess', level = 2 WHERE code = 'ess.team-shifts';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'ess.team-shifts' AND parent.code = 'ess';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE m.code = 'ess.team-shifts' AND r.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
