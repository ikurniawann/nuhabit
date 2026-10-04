-- Restore POS report menus soft-deleted by iam-menus seeder whitelist gap.
-- Codes were inserted in seeder but missing from the retire NOT IN list, so
-- re-running db:seed:iam-menus deactivated them (same class of incident as
-- 20260720070000_restore_menus_seeder_casualty).

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('pos.reports.transactions', 'Transaksi', '/dashboard/pos/reports/transactions',
   'clipboard', 'sidebar', 25, '{"actions":["read"]}'::jsonb),
  ('pos.reports.product-sales', 'Penjualan Produk', '/dashboard/pos/reports/product-sales',
   'cube', 'sidebar', 28, '{"actions":["read"]}'::jsonb)
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
WHERE code IN ('pos.reports.transactions', 'pos.reports.product-sales');

UPDATE iam.menus child
SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code IN ('pos.reports.transactions', 'pos.reports.product-sales')
  AND parent.code = 'pos.reports';

-- Grant: mirror whoever can open Profit report
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT rmp.role_id, m_new.id, COALESCE(rmp.granted_actions, '["read"]'::jsonb)
FROM iam.role_menu_permissions rmp
JOIN iam.menus m_profit ON m_profit.id = rmp.menu_id
  AND m_profit.code = 'pos.reports.profit'
CROSS JOIN iam.menus m_new
WHERE m_new.code IN ('pos.reports.transactions', 'pos.reports.product-sales')
  AND rmp.is_active
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();
