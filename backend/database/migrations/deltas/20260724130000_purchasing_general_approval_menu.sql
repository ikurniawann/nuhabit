-- =============================================================================
-- EPIC-026 B5 — Menu "Persetujuan PR & PO" (scope 'general').
-- Menambah 2 sidebar (approval-pr, approval-po) di grup `items.general.purchasing`
-- (grup dibuat B2b, migrasi 20260723230000). Halaman = fitur shared approval
-- di-mount dengan moduleType="general" (bukan klon).
-- Route fisik langsung (TANPA rewrite next.config, konsisten B1–B4):
--   /dashboard/items/general/approval/pr
--   /dashboard/items/general/approval/po
-- Urutan sidebar mengikuti alur kerja: PR(30) > ApprovalPR(35) > PO(40) >
-- ApprovalPO(45) > Receive(50). Idempoten (ON CONFLICT + parent/module/level + grant).
-- =============================================================================

-- ── Sidebar: Persetujuan PR ─────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('items.general.purchasing.approval-pr', 'Persetujuan PR', '/dashboard/items/general/approval/pr',
        'clipboard-document-check', 'sidebar', 35, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'items', level = 4 WHERE code = 'items.general.purchasing.approval-pr';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'items.general.purchasing.approval-pr' AND parent.code = 'items.general.purchasing';

-- ── Sidebar: Persetujuan PO ─────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('items.general.purchasing.approval-po', 'Persetujuan PO', '/dashboard/items/general/approval/po',
        'clipboard-document-check', 'sidebar', 45, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'items', level = 4 WHERE code = 'items.general.purchasing.approval-po';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'items.general.purchasing.approval-po' AND parent.code = 'items.general.purchasing';

-- ── Grant: role sama dengan menu general lain (B1–B4) ───────────────────────
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'purchasing_admin', 'purchasing_manager',
                 'purchasing_staff', 'qc_staff', 'warehouse_admin', 'warehouse_staff',
                 'sulu_bandung_demo')
  AND m.code IN ('items.general.purchasing.approval-pr', 'items.general.purchasing.approval-po')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
