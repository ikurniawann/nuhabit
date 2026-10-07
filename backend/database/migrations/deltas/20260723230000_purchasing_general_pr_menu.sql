-- =============================================================================
-- EPIC-026 B2b — Menu "Purchasing > Permintaan Barang" (scope 'general').
-- Hierarki: items.general > items.general.purchasing > pr.
-- Route fisik langsung (TANPA rewrite next.config, konsisten B1):
--   /dashboard/items/general/purchasing/pr
-- Pola idempoten ala B1 (ON CONFLICT upsert + set parent/module/level + grant).
-- Grant ke role yang sama dengan menu master general (B1).
-- =============================================================================

-- ── Sub-grup: items.general.purchasing ──────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('items.general.purchasing', 'Purchasing', NULL, 'shopping', 'group', 20, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'items', level = 3 WHERE code = 'items.general.purchasing';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'items.general.purchasing' AND parent.code = 'items.general';

-- ── Sidebar: Permintaan Barang (Purchase Request) ───────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('items.general.purchasing.pr', 'Permintaan Barang', '/dashboard/items/general/purchasing/pr',
        'file-text', 'sidebar', 30, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'items', level = 4 WHERE code = 'items.general.purchasing.pr';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'items.general.purchasing.pr' AND parent.code = 'items.general.purchasing';

-- ── Grant: role sama dengan menu master general (B1) ────────────────────────
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'purchasing_admin', 'purchasing_manager',
                 'purchasing_staff', 'qc_staff', 'warehouse_admin', 'warehouse_staff',
                 'sulu_bandung_demo')
  AND m.code IN ('items.general.purchasing', 'items.general.purchasing.pr')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
