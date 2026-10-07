-- EPIC-032 A4 — role baru `marketing` (keputusan owner 26 Jul: pengelola
-- promo = super_admin + marketing). Pola preseden role `sales` (EPIC-022) /
-- `finance_staff` (EPIC-025): ESS-only utk modul lain + boleh masuk modul
-- sendiri via ROLE_MODULE_PATHS (access.ts). Idempoten, reversible.

INSERT INTO iam.roles (code, name, description, is_system, is_active)
VALUES ('marketing', 'Marketing',
        'Pengelola promo: campaign, kode promo, voucher (EPIC-032)',
        false, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  is_active = true, deleted_at = NULL, updated_at = now();

-- Grant menu Promo (level 1 + level 2) utk marketing — super_admin sudah
-- di-grant di 20260726110000
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'marketing' AND m.code IN ('promo', 'promo.campaigns')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- Marketing tetap karyawan: grant menu ESS (Area Karyawan) seperti role
-- staf lain agar beranda /dashboard/me berfungsi
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'marketing'
  AND (m.code = 'ess' OR m.code LIKE 'ess.%')
  AND m.is_active = true AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
