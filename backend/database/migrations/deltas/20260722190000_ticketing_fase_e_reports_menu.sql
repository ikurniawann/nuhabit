-- EPIC-023 Fase E: Laporan & Ops — menu Laporan Ticketing.
-- Laporan operasional venue: traffic gate, revenue tiket (net void, per
-- produk/kanal/musim/paket via price_context ledger), F&B on-tab, uang
-- masuk per metode (rekonsiliasi kasir), rekap gelang, tab menggantung.
-- Akses: super_admin + pos_supervisor (kasir 'pos' tidak perlu laporan).

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('ticketing.reports', 'Laporan',
        '/dashboard/ticketing/reports', 'ticket', 'sidebar', 8,
        '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'ticketing', level = 2
WHERE code = 'ticketing.reports';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'ticketing.reports' AND parent.code = 'ticketing';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'pos_supervisor')
  AND m.code = 'ticketing.reports'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
