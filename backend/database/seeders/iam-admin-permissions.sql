-- =============================================================================
-- IAM Admin Permissions — Super Admin & Administrator (all menus, all actions)
-- Run: npm run db:seed:iam-admin
-- =============================================================================

INSERT INTO iam.roles (code, name, description, is_system, is_active) VALUES
  ('super_admin', 'Super Admin', 'Akses penuh ke seluruh sistem', true, true),
  ('admin',       'Administrator', 'Akses administrasi sistem', true, true)
ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  is_system   = EXCLUDED.is_system,
  is_active   = true,
  updated_at  = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete","approve","export","import","execute"]'::jsonb
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.deleted_at IS NULL
  AND m.is_active = true
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();

UPDATE iam.role_menu_permissions rmp
SET is_active = false, updated_at = now()
FROM iam.menus m, iam.roles r
WHERE rmp.menu_id = m.id
  AND rmp.role_id = r.id
  AND r.code IN ('super_admin', 'admin')
  AND (m.deleted_at IS NOT NULL OR m.is_active = false);
