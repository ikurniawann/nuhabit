-- POS Classic — menu kasir gaya klasik (tombol besar, keypad) untuk layar sentuh.
-- Skin baru di atas engine kasir yang sama; menu Kasir lama tidak diubah.

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('pos.operations.cashier-classic', 'POS Classic', '/dashboard/pos/classic', 'monitor',
   'sidebar', 11, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'pos' WHERE code = 'pos.operations.cashier-classic';

UPDATE iam.menus child SET parent_id = parent.id, updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'pos.operations'
  AND child.code = 'pos.operations.cashier-classic';

WITH RECURSIVE tree AS (
  SELECT id, 1 AS lvl FROM iam.menus WHERE code = 'pos'
  UNION ALL
  SELECT m.id, t.lvl + 1 FROM iam.menus m JOIN tree t ON m.parent_id = t.id
)
UPDATE iam.menus m SET level = t.lvl, updated_at = now()
FROM tree t WHERE t.id = m.id AND m.level IS DISTINCT FROM t.lvl;

-- Hak akses mengikuti menu Kasir: siapa pun yang boleh membuka Kasir boleh
-- membuka POS Classic, dengan aksi yang sama.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT rmp.role_id, classic.id, rmp.granted_actions
FROM iam.role_menu_permissions rmp
JOIN iam.menus cashier ON cashier.id = rmp.menu_id AND cashier.code = 'pos.operations.cashier'
JOIN iam.menus classic ON classic.code = 'pos.operations.cashier-classic'
WHERE rmp.is_active
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
