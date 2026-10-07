ALTER TABLE configuration.users
  ADD COLUMN IF NOT EXISTS can_central_checkout boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN configuration.users.can_central_checkout IS
  'User ditugaskan jaga kasir pusat. Harus plus IAM pos.cashier.central.';

INSERT INTO iam.menus (
  code, menu_name, route_path, icon, menu_type, order_number, permission_context,
  is_visible
)
VALUES (
  'pos.cashier.central',
  'Kasir Pusat',
  NULL,
  'shopping',
  'sidebar',
  12,
  '{"actions":["read"]}'::jsonb,
  false
)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  is_visible = false,
  is_active = true,
  deleted_at = NULL,
  updated_at = now();

UPDATE iam.menus SET module = 'pos', level = 3
WHERE code = 'pos.cashier.central';

UPDATE iam.menus child
SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'pos.cashier.central'
  AND parent.code = 'pos.operations';

-- Capability only — keep hidden from sidebar.
UPDATE iam.menus SET is_visible = false WHERE code = 'pos.cashier.central';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, '["read"]'::jsonb, true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'pos_supervisor', 'pos')
  AND m.code = 'pos.cashier.central'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();
