-- EPIC-008 Fase D: pinjaman (kasbon) mengalir ke payroll + limitasi.
--   1. Kolom limitasi pinjaman di payroll_settings (konfigurabel):
--      - loan_max_installment_percent: cicilan/bulan maks sebagai % gaji
--        pokok (praktik umum 30%).
--      - loan_max_active_per_employee: jumlah pinjaman aktif (pending/
--        approved belum lunas) bersamaan per karyawan.
--   2. Menu Penggajian → Pinjaman (selama ini API loans tanpa UI).

ALTER TABLE hris.payroll_settings
  ADD COLUMN IF NOT EXISTS loan_max_installment_percent numeric(5,2) NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS loan_max_active_per_employee integer NOT NULL DEFAULT 1;

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('hris.compensation.loans', 'Pinjaman', '/dashboard/hris/loans', 'banknotes',
        'sidebar', 30, '{"actions":["read","create","update","approve"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'hris', level = 3 WHERE code = 'hris.compensation.loans';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'hris.compensation.loans' AND parent.code = 'hris.compensation';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete","approve","export","import","execute"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin') AND m.code = 'hris.compensation.loans'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('hrd', 'finance_staff') AND m.code = 'hris.compensation.loans'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
