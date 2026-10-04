-- TV Antrian customer — sidebar POS → Dapur & Cetak.
-- Fullscreen murni di /pos/queue (luar layout dashboard), mirip Layar Customer.
-- Grant: siapa pun yang boleh KDS atau Kasir boleh buka papan antrian.

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES (
  'pos.kitchen.queue-board',
  'TV Antrian',
  '/pos/queue',
  'video',
  'sidebar',
  15,
  '{"actions":["read"]}'::jsonb
)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number,
  is_active = true,
  is_visible = true,
  deleted_at = NULL,
  updated_at = now();

UPDATE iam.menus SET module = 'pos', level = 3
WHERE code = 'pos.kitchen.queue-board';

UPDATE iam.menus child
SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'pos.kitchen.queue-board'
  AND parent.code = 'pos.kitchen';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT DISTINCT rmp.role_id, m_new.id, '["read"]'::jsonb
FROM iam.role_menu_permissions rmp
JOIN iam.menus m_src ON m_src.id = rmp.menu_id
  AND m_src.code IN ('pos.kitchen.kds', 'pos.operations.cashier')
CROSS JOIN iam.menus m_new
WHERE m_new.code = 'pos.kitchen.queue-board'
  AND rmp.is_active
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, '["read"]'::jsonb, true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code = 'pos.kitchen.queue-board'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();
