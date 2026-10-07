-- =============================================================================
-- IAM Role Permissions — operational roles (non admin)
-- Run: npm run db:seed:iam-roles
-- Prasyarat: npm run db:seed:iam-menus
-- =============================================================================

INSERT INTO iam.roles (code, name, description, is_system, is_active) VALUES
  ('hrd',                'HRD',                'HR & Recruitment',              false, true),
  ('hiring_manager',     'Hiring Manager',     'Rekrutmen / interview',         false, true),
  ('direksi',            'Direksi',            'Eksekutif / overview',          false, true),
  ('purchasing_admin',   'Purchasing Admin',   'Administrasi pembelian',        false, true),
  ('purchasing_manager', 'Purchasing Manager', 'Manajemen pembelian',           false, true),
  ('purchasing_staff',   'Purchasing Staff',   'Staf pembelian',                false, true),
  ('finance_staff',      'Finance Staff',      'Keuangan & akuntansi',          false, true),
  ('warehouse_staff',    'Warehouse Staff',    'Gudang',                        false, true),
  ('warehouse_admin',    'Warehouse Admin',    'Administrasi gudang',           false, true),
  ('pos',                'POS Cashier',        'Kasir POS',                     false, true),
  ('pos_supervisor',     'POS Supervisor',     'Supervisor POS',                false, true),
  ('qc_staff',           'QC Staff',           'Quality control',               false, true),
  ('sulu_bandung_demo',  'Sulu Bandung Demo',  'Demo cabang Sulu Bandung: Items, Inventory, POS', false, true)
ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active   = true,
  updated_at  = now();

-- hrd -> HRIS + Settings
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'hrd' AND m.deleted_at IS NULL AND m.is_active = true
  AND (m.code = 'dashboard' OR m.module IN ('hris', 'settings'))
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- hiring_manager -> subset HRIS
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'hiring_manager' AND m.deleted_at IS NULL AND m.is_active = true
  AND (
    m.code IN ('dashboard', 'hris')
    OR m.code LIKE 'hris.recruitment%'
    OR m.code = 'hris.insights.analytics'
  )
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- Purchasing / warehouse / QC -> Items (+ purchasing reports subtree)
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('purchasing_admin', 'purchasing_manager', 'purchasing_staff', 'warehouse_staff', 'warehouse_admin', 'qc_staff')
  AND m.deleted_at IS NULL AND m.is_active = true
  AND (m.code = 'dashboard' OR m.module IN ('items', 'purchasing'))
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- finance_staff -> dashboard only
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'finance_staff' AND m.deleted_at IS NULL AND m.is_active = true
  AND m.code = 'dashboard'
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- pos roles
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('pos', 'pos_supervisor') AND m.deleted_at IS NULL AND m.is_active = true
  AND (m.code = 'dashboard' OR m.module = 'pos')
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- direksi -> overview lintas modul
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'direksi' AND m.deleted_at IS NULL AND m.is_active = true
  AND (
    m.code IN ('dashboard', 'hris', 'hris.insights.analytics', 'hris.insights.reports', 'pos', 'pos.reports.dashboard', 'pos.reports.profit', 'pos.reports.transactions', 'pos.reports.rush-hour', 'pos.reports.product-sales', 'pos.reports.voids', 'pos.reports.closing')
    OR m.module = 'crm'
  )
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- sulu_bandung_demo -> Items + POS (tanpa purchasing reports)
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'sulu_bandung_demo' AND m.deleted_at IS NULL AND m.is_active = true
  AND (
    m.code = 'dashboard'
    OR m.module = 'pos'
    OR (m.module = 'items' AND m.code NOT LIKE 'items.reports%')
  )
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- Migrate legacy sulu_dago_demo assignments
DO $$
DECLARE
    v_old_id uuid;
    v_new_id uuid;
BEGIN
    SELECT id INTO v_old_id FROM iam.roles WHERE code = 'sulu_dago_demo' LIMIT 1;
    SELECT id INTO v_new_id FROM iam.roles WHERE code = 'sulu_bandung_demo' LIMIT 1;

    IF v_old_id IS NULL OR v_new_id IS NULL OR v_old_id = v_new_id THEN
        RETURN;
    END IF;

    INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
    SELECT v_new_id, menu_id, granted_actions, is_active
    FROM iam.role_menu_permissions
    WHERE role_id = v_old_id
    ON CONFLICT (role_id, menu_id) DO UPDATE
        SET is_active = EXCLUDED.is_active,
            granted_actions = EXCLUDED.granted_actions,
            updated_at = now();

    UPDATE iam.user_roles
    SET role_id = v_new_id
    WHERE role_id = v_old_id;

    UPDATE iam.roles
    SET is_active = false, updated_at = now()
    WHERE id = v_old_id;
END $$;
