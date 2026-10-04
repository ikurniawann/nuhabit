-- =============================================================================
-- Restore POS sidebar: ARK & XP (kurs 1 ARK = Rp X)
-- Hidden by 20260720180000 because the page was thought to 404.
-- Page now exists at /dashboard/pos/loyalty-settings.
-- =============================================================================

UPDATE iam.menus
SET menu_name = 'ARK & XP',
    route_path = '/dashboard/pos/loyalty-settings',
    icon = 'settings',
    menu_type = 'sidebar',
    order_number = 20,
    is_active = true,
    is_visible = true,
    deleted_at = NULL,
    updated_at = now()
WHERE code = 'pos.loyalty.settings';

UPDATE iam.menus child
SET parent_id = parent.id,
    module = 'pos',
    level = 3
FROM iam.menus parent
WHERE child.code = 'pos.loyalty.settings'
  AND parent.code = 'pos.loyalty';

-- Grant: mirror whoever can open Topup (same POS → Member group)
INSERT INTO iam.role_menu_permissions (role_id, menu_id, is_active, granted_actions)
SELECT rmp.role_id, settings.id, true,
       COALESCE(rmp.granted_actions, '["read","update"]'::jsonb)
FROM iam.role_menu_permissions rmp
JOIN iam.menus topup ON topup.id = rmp.menu_id AND topup.code = 'pos.loyalty.topup'
CROSS JOIN iam.menus settings
WHERE settings.code = 'pos.loyalty.settings'
  AND rmp.is_active
  AND NOT EXISTS (
    SELECT 1
    FROM iam.role_menu_permissions existing
    WHERE existing.role_id = rmp.role_id
      AND existing.menu_id = settings.id
  );

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, '["read","update"]'::jsonb, true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code = 'pos.loyalty.settings'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();
