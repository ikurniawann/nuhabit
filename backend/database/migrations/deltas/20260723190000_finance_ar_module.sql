-- EPIC-025: modul Finance — Invoice & Pembayaran (AR). Keputusan owner
-- 2026-07-23 Opsi B: sales hanya MENGAJUKAN invoice (status 'diajukan'),
-- finance (finance_staff + super_admin) yang menerbitkan/mengirim/membatalkan
-- dan mencatat pembayaran lewat /dashboard/finance/invoices.

-- ============================================================
-- 1. Status 'diajukan' — pengajuan dari sales sebelum diproses finance
-- ============================================================
ALTER TABLE crm.crm_sales_invoices
  DROP CONSTRAINT IF EXISTS crm_sales_invoices_status_check;
ALTER TABLE crm.crm_sales_invoices
  ADD CONSTRAINT crm_sales_invoices_status_check
  CHECK (status IN ('diajukan', 'draft', 'terkirim', 'batal'));
-- Catatan: index unik uq_crm_sales_invoices_term_active memakai
-- status <> 'batal' — pengajuan 'diajukan' otomatis ikut mengunci termin.

-- ============================================================
-- 2. Menu: Finance > Invoice & Pembayaran
-- ============================================================
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('finance', 'Finance', NULL, 'banknotes',
        'group', 84, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'finance', level = 1, parent_id = NULL
WHERE code = 'finance';

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('finance.invoices', 'Invoice & Pembayaran', '/dashboard/finance/invoices',
        'banknotes', 'sidebar', 10, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'finance', level = 2 WHERE code = 'finance.invoices';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'finance.invoices' AND parent.code = 'finance';

-- ============================================================
-- 3. Grant: super_admin + finance_staff
-- ============================================================
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'finance_staff')
  AND m.code IN ('finance', 'finance.invoices')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
