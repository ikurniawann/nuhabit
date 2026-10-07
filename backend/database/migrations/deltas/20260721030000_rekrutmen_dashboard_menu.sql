-- EPIC-021: dashboard rekrutmen pindah dari /dashboard ke /dashboard/rekrutmen
-- karena /dashboard kini menjadi Ringkasan Eksekutif (super_admin + direksi).
--
-- Menu baru diletakkan paling atas grup Rekrutmen (order 5, sebelum Kandidat
-- di 10). Izin disalin dari pemilik izin Pipeline — audiens dashboard rekrutmen
-- sama dengan pengguna pipeline.

INSERT INTO iam.menus (parent_id, code, menu_name, description, route_path, module, menu_type, icon, level, order_number)
SELECT
  parent.id,
  'hris.recruitment.dashboard',
  'Dashboard Rekrutmen',
  'Ringkasan kandidat, pipeline, dan kandidat yang butuh perhatian',
  '/dashboard/rekrutmen',
  'hris',
  'sidebar',
  'chart',
  2,
  5
FROM iam.menus parent
WHERE parent.code = 'hris.recruitment' AND parent.deleted_at IS NULL
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_menu_permissions (role_id, menu_id, is_active)
SELECT rmp.role_id, baru.id, true
  FROM iam.role_menu_permissions rmp
  JOIN iam.menus src ON src.id = rmp.menu_id AND src.code = 'hris.recruitment.pipeline'
  CROSS JOIN iam.menus baru
 WHERE baru.code = 'hris.recruitment.dashboard'
   AND rmp.is_active
   AND NOT EXISTS (
     SELECT 1 FROM iam.role_menu_permissions ada
      WHERE ada.role_id = rmp.role_id AND ada.menu_id = baru.id
   );
