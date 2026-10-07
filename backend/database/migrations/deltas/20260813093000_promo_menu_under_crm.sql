-- Move Promo under CRM sidebar (was standalone module EPIC-032).
-- Soft-hide top-level `promo`; keep leaf as CRM child pointing to /dashboard/promo.

UPDATE iam.menus
SET menu_name = 'Promo',
    route_path = '/dashboard/promo',
    icon = 'ticket',
    module = 'crm',
    level = 2,
    order_number = 35,
    menu_type = 'sidebar',
    is_active = true,
    is_visible = true,
    deleted_at = NULL,
    updated_at = now()
WHERE code = 'promo.campaigns';

UPDATE iam.menus child
SET parent_id = parent.id,
    updated_at = now()
FROM iam.menus parent
WHERE child.code = 'promo.campaigns'
  AND parent.code = 'crm';

-- Hide standalone Promo module folder
UPDATE iam.menus
SET is_active = false,
    is_visible = false,
    deleted_at = COALESCE(deleted_at, now()),
    updated_at = now()
WHERE code = 'promo';

-- Ensure CRM parent + Promo leaf granted to super_admin & marketing
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'marketing')
  AND m.code IN ('crm', 'promo.campaigns')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();
