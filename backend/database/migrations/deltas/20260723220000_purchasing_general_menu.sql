-- =============================================================================
-- EPIC-026 B1 — Menu "Barang Operasional" (scope 'general') di grup Items.
-- Hierarki: items > items.general > items.general.master > {items, categories}.
-- Pola idempoten ala migrasi finance (ON CONFLICT upsert + set parent/module/
-- level + grant role). Grant ke role yang sama dengan master product.
-- =============================================================================

-- ── Grup: items.general ─────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('items.general', 'Barang Operasional', NULL, 'cube', 'group', 30, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'items', level = 2 WHERE code = 'items.general';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'items.general' AND parent.code = 'items';

-- ── Sub-grup: items.general.master ──────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('items.general.master', 'Master Data', NULL, 'database', 'group', 10, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'items', level = 3 WHERE code = 'items.general.master';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'items.general.master' AND parent.code = 'items.general';

-- ── Sidebar: barang (item master) ───────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('items.general.master.items', 'Barang Operasional', '/dashboard/items/general/items',
        'cube', 'sidebar', 10, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'items', level = 4 WHERE code = 'items.general.master.items';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'items.general.master.items' AND parent.code = 'items.general.master';

-- ── Sidebar: kategori ───────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('items.general.master.categories', 'Kategori', '/dashboard/items/general/categories',
        'clipboard', 'sidebar', 20, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'items', level = 4 WHERE code = 'items.general.master.categories';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'items.general.master.categories' AND parent.code = 'items.general.master';

-- ── Grant: role sama dengan master product ──────────────────────────────────
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'purchasing_admin', 'purchasing_manager',
                 'purchasing_staff', 'qc_staff', 'warehouse_admin', 'warehouse_staff',
                 'sulu_bandung_demo')
  AND m.code IN ('items.general', 'items.general.master',
                 'items.general.master.items', 'items.general.master.categories')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
