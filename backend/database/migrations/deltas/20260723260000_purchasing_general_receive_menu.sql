-- =============================================================================
-- EPIC-026 B4 — Menu "Purchasing > Penerimaan Barang" (scope 'general').
-- Menambah sidebar `items.general.purchasing.receive` di grup
-- `items.general.purchasing` (grup dibuat di B2b, migrasi 20260723230000).
-- Route fisik langsung (TANPA rewrite next.config, konsisten B1/B2/B3):
--   /dashboard/items/general/purchasing/receive
-- Idempoten (ON CONFLICT upsert + set parent/module/level + grant 9 role sama).
-- =============================================================================

-- ── Sidebar: Penerimaan Barang ──────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('items.general.purchasing.receive', 'Penerimaan Barang', '/dashboard/items/general/purchasing/receive',
        'inbox-arrow-down', 'sidebar', 50, '{"actions":["read","create","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'items', level = 4 WHERE code = 'items.general.purchasing.receive';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'items.general.purchasing.receive' AND parent.code = 'items.general.purchasing';

-- ── Grant: role sama dengan menu general lain (B1/B2/B3) ────────────────────
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'purchasing_admin', 'purchasing_manager',
                 'purchasing_staff', 'qc_staff', 'warehouse_admin', 'warehouse_staff',
                 'sulu_bandung_demo')
  AND m.code = 'items.general.purchasing.receive'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
