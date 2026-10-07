-- EPIC-022 Fase B: Pipeline Kanban Deals — menu Pipeline (super_admin+sales)
-- + menu Pengaturan Funnel (super_admin saja, konfigurasi tahap).
-- Tabel deals/stages/lost_reasons sudah dibuat di Fase A
-- (20260721130000_sales_funnel_fase_a.sql) — delta ini hanya menu & grant.

-- ============================================================
-- 1. Menu: Pipeline Deals (kanban)
-- ============================================================
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('sales-funnel.pipeline', 'Pipeline Deals', '/dashboard/sales-funnel/pipeline',
        'chart-bar', 'sidebar', 20, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'sales-funnel', level = 2 WHERE code = 'sales-funnel.pipeline';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'sales-funnel.pipeline' AND parent.code = 'sales-funnel';

-- ============================================================
-- 2. Menu: Pengaturan Funnel (tahap pipeline) — super_admin saja
-- ============================================================
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('sales-funnel.settings', 'Pengaturan Funnel', '/dashboard/sales-funnel/settings',
        'settings', 'sidebar', 90, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'sales-funnel', level = 2 WHERE code = 'sales-funnel.settings';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'sales-funnel.settings' AND parent.code = 'sales-funnel';

-- ============================================================
-- 3. Grant: pipeline → super_admin + sales; settings → super_admin
-- ============================================================
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'sales')
  AND m.code = 'sales-funnel.pipeline'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'super_admin'
  AND m.code = 'sales-funnel.settings'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
