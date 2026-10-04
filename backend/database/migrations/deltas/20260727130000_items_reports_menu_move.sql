-- Move purchasing reports menus under Items → Reports and rename labels.
-- Keeps existing role grants by copying permissions from legacy codes.

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('items.reports', 'Reports', '/dashboard/purchasing/reports', 'reports', 'group', 30, '{"actions":["read"]}'::jsonb),
  ('items.reports.stock-card', 'Stock Card', '/dashboard/purchasing/reports/stock-card', 'clipboard', 'sidebar', 10, '{"actions":["read"]}'::jsonb),
  ('items.reports.inventory-valuation', 'Inventory Valuation', '/dashboard/purchasing/reports/inventory-valuation', 'database', 'sidebar', 20, '{"actions":["read"]}'::jsonb),
  ('items.reports.po-summary', 'PO Summary', '/dashboard/purchasing/reports/po-summary', 'shopping', 'sidebar', 30, '{"actions":["read"]}'::jsonb),
  ('items.reports.po-detail', 'PO Detail', '/dashboard/purchasing/reports/po-detail', 'document-text', 'sidebar', 40, '{"actions":["read"]}'::jsonb),
  ('items.reports.supplier-performance', 'Supplier Performance', '/dashboard/purchasing/reports/supplier-performance', 'building', 'sidebar', 50, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true,
  is_visible = true,
  deleted_at = NULL,
  updated_at = now();

UPDATE iam.menus
SET module = 'items',
    level = (length(code) - length(replace(code, '.', ''))) + 1,
    updated_at = now()
WHERE code LIKE 'items.reports%';

UPDATE iam.menus child
SET parent_id = parent.id,
    updated_at = now()
FROM iam.menus parent
WHERE child.code = 'items.reports'
  AND parent.code = 'items';

UPDATE iam.menus child
SET parent_id = parent.id,
    updated_at = now()
FROM iam.menus parent
WHERE child.code LIKE 'items.reports.%'
  AND parent.code = 'items.reports';

-- Copy role permissions from legacy purchasing.reports* menus
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT rmp.role_id, m_new.id, rmp.granted_actions, true
FROM iam.role_menu_permissions rmp
JOIN iam.menus m_old ON m_old.id = rmp.menu_id
JOIN iam.menus m_new
  ON m_new.code = CASE m_old.code
    WHEN 'purchasing.reports' THEN 'items.reports'
    WHEN 'purchasing.reports.stock-card' THEN 'items.reports.stock-card'
    WHEN 'purchasing.reports.inventory-valuation' THEN 'items.reports.inventory-valuation'
    WHEN 'purchasing.reports.po-summary' THEN 'items.reports.po-summary'
    WHEN 'purchasing.reports.po-detail' THEN 'items.reports.po-detail'
    WHEN 'purchasing.reports.supplier-performance' THEN 'items.reports.supplier-performance'
    ELSE NULL
  END
WHERE m_old.code LIKE 'purchasing.reports%'
  AND rmp.is_active
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();

-- Soft-delete legacy group under Purchasing/Laporan
UPDATE iam.menus
SET is_active = false,
    is_visible = false,
    deleted_at = COALESCE(deleted_at, now()),
    updated_at = now()
WHERE code LIKE 'purchasing.reports%'
  AND deleted_at IS NULL;
