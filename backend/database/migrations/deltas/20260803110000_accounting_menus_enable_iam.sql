-- =============================================================================
-- Re-enable Accounting menus + IAM grants (super_admin, admin, finance_staff)
-- Menus previously soft-deleted / hidden on shared DB.
-- =============================================================================

UPDATE iam.menus
SET is_active = true,
    is_visible = true,
    deleted_at = NULL,
    deleted_by = NULL,
    updated_at = now()
WHERE code IN (
  'accounting',
  'accounting.chart-of-accounts',
  'accounting.account-types'
);

UPDATE iam.menus
SET module = 'accounting', level = 1, parent_id = NULL
WHERE code = 'accounting';

UPDATE iam.menus child
SET module = 'accounting',
    level = 2,
    parent_id = parent.id
FROM iam.menus parent
WHERE child.code IN ('accounting.chart-of-accounts', 'accounting.account-types')
  AND parent.code = 'accounting';

-- Full actions for super_admin + admin
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id,
       '["read","create","update","delete","approve","export","import","execute"]'::jsonb,
       true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code IN (
    'accounting',
    'accounting.chart-of-accounts',
    'accounting.account-types'
  )
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();

-- finance_staff: actions from each menu's permission_context
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id,
       COALESCE(m.permission_context->'actions', '["read"]'::jsonb),
       true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code = 'finance_staff'
  AND m.code IN (
    'accounting',
    'accounting.chart-of-accounts',
    'accounting.account-types'
  )
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
