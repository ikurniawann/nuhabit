-- EPIC-024 — menu sidebar "Layar Customer" di POS → Operasional.
-- Grant meniru persis pemegang menu Kasir (pos.operations.cashier):
-- siapa pun yang boleh mengasir boleh membuka layar customer.

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('pos.operations.customer-display', 'Layar Customer',
        '/dashboard/pos/customer-display', 'monitor', 'sidebar', 12,
        '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'pos', level = 3
WHERE code = 'pos.operations.customer-display';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'pos.operations.customer-display'
  AND parent.code = 'pos.operations';

-- Salin grant dari menu Kasir — sumber kebenaran siapa yang mengasir
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT rmp.role_id, m_new.id, '["read"]'::jsonb
FROM iam.role_menu_permissions rmp
JOIN iam.menus m_cashier ON m_cashier.id = rmp.menu_id
  AND m_cashier.code = 'pos.operations.cashier'
CROSS JOIN iam.menus m_new
WHERE m_new.code = 'pos.operations.customer-display'
  AND rmp.is_active
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
