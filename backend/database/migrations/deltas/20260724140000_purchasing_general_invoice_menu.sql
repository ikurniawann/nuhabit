-- =============================================================================
-- EPIC-026 B5 — Menu "Invoice & Pembayaran" (scope 'general').
-- Menambah sidebar `items.general.purchasing.invoice` di grup
-- `items.general.purchasing`. Halaman = fitur shared vendor-payments di-mount
-- dengan moduleType="general". Route fisik langsung (TANPA rewrite next.config):
--   /dashboard/items/general/purchasing/invoice
-- Urutan sidebar 60 (setelah Receive=50). Idempoten.
-- =============================================================================

-- ── Sidebar: Invoice & Pembayaran ───────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('items.general.purchasing.invoice', 'Invoice & Pembayaran', '/dashboard/items/general/purchasing/invoice',
        'banknotes', 'sidebar', 60, '{"actions":["read","create","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'items', level = 4 WHERE code = 'items.general.purchasing.invoice';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'items.general.purchasing.invoice' AND parent.code = 'items.general.purchasing';

-- ── Grant: role sama dengan menu general lain (B1–B4) ───────────────────────
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'purchasing_admin', 'purchasing_manager',
                 'purchasing_staff', 'qc_staff', 'warehouse_admin', 'warehouse_staff',
                 'sulu_bandung_demo')
  AND m.code = 'items.general.purchasing.invoice'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
