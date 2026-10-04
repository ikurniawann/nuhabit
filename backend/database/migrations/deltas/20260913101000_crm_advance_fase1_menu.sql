-- EPIC-050 Fase 1 (T-1.2): satu modul CRM — Sales Funneling digabung ke bawah
-- CRM (keputusan owner 2026-09-13 #1). KODE menu & route TIDAK diubah supaya
-- gate IAM (prefix `sales-funnel`, `crm.members`, dst.) dan bookmark tetap
-- berlaku; yang berubah hanya pohon (parent_id/level/urutan) dan label.
--
-- Struktur target:
--   CRM
--   ├── Overview                (crm.overview)
--   ├── Sales                   (sales-funnel) → Leads, Accounts*, Contacts*, Pipeline, Tasks & Kalender
--   ├── Customer Care           (crm.members)  → Inbox WhatsApp, Google Review
--   ├── Members & Loyalty       (crm.loyalty)  → Members, Rewards, Avatars, Wallpapers, Badges
--   ├── Marketing*              (crm.marketing)→ Kampanye WA, Promo
--   ├── Reports & Dashboards    (crm.reports)  → Laporan CRM, Laporan Funnel
--   └── Pengaturan CRM          (crm.settings) → Pengaturan CRM, Pengaturan Funnel
--   (* = baru)

-- ============================================================
-- 1. Menu baru: Accounts, Contacts, grup Marketing
-- ============================================================
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('sales-funnel.accounts', 'Accounts', '/dashboard/sales-funnel/accounts', 'building',
   'sidebar', 20, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('sales-funnel.contacts', 'Contacts', '/dashboard/sales-funnel/contacts', 'users',
   'sidebar', 30, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('crm.marketing', 'Marketing', NULL, 'megaphone',
   'group', 40, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'sales-funnel'
WHERE code IN ('sales-funnel.accounts', 'sales-funnel.contacts');
UPDATE iam.menus SET module = 'crm' WHERE code = 'crm.marketing';

-- ============================================================
-- 2. Label & urutan grup level-2 di bawah CRM
-- ============================================================
UPDATE iam.menus SET menu_name = 'Overview',           order_number = 0,  updated_at = now() WHERE code = 'crm.overview';
UPDATE iam.menus SET menu_name = 'Sales', icon = 'chart-pie', menu_type = 'group', route_path = NULL,
                     order_number = 10, updated_at = now() WHERE code = 'sales-funnel';
UPDATE iam.menus SET menu_name = 'Customer Care',      order_number = 20, updated_at = now() WHERE code = 'crm.members';
UPDATE iam.menus SET menu_name = 'Members & Loyalty',  order_number = 30, updated_at = now() WHERE code = 'crm.loyalty';
UPDATE iam.menus SET menu_name = 'Reports & Dashboards', order_number = 50, updated_at = now() WHERE code = 'crm.reports';
UPDATE iam.menus SET menu_name = 'Pengaturan CRM',     order_number = 60, updated_at = now() WHERE code = 'crm.settings';

-- Tasks & Kalender menggantikan "Follow-up Hari Ini" (route lama tetap ada → redirect)
UPDATE iam.menus SET menu_name = 'Tasks & Kalender', route_path = '/dashboard/sales-funnel/tasks',
                     icon = 'calendar', order_number = 50, updated_at = now()
WHERE code = 'sales-funnel.followups';
UPDATE iam.menus SET order_number = 10, updated_at = now() WHERE code = 'sales-funnel.leads';
UPDATE iam.menus SET order_number = 40, updated_at = now() WHERE code = 'sales-funnel.pipeline';
UPDATE iam.menus SET menu_name = 'Laporan Funnel',    order_number = 20, updated_at = now() WHERE code = 'sales-funnel.reports';
UPDATE iam.menus SET menu_name = 'Pengaturan Funnel', order_number = 20, updated_at = now() WHERE code = 'sales-funnel.settings';
UPDATE iam.menus SET menu_name = 'Members',           order_number = 5,  updated_at = now() WHERE code = 'crm.members.list';
UPDATE iam.menus SET menu_name = 'Kampanye WA',       order_number = 10, updated_at = now() WHERE code = 'crm.campaigns';
UPDATE iam.menus SET order_number = 20, updated_at = now() WHERE code = 'crm.promo';
UPDATE iam.menus SET order_number = 40, updated_at = now() WHERE code = 'crm.wallpapers';
UPDATE iam.menus SET order_number = 50, updated_at = now() WHERE code = 'crm.badges';

-- ============================================================
-- 3. Re-parent (pohon baru)
-- ============================================================
-- helper: set parent by code
UPDATE iam.menus child SET parent_id = parent.id, updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'crm'
  AND child.code IN ('sales-funnel', 'crm.marketing');

UPDATE iam.menus child SET parent_id = parent.id, updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'sales-funnel'
  AND child.code IN ('sales-funnel.accounts', 'sales-funnel.contacts');

UPDATE iam.menus child SET parent_id = parent.id, updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'crm.loyalty'
  AND child.code IN ('crm.members.list', 'crm.wallpapers', 'crm.badges');

UPDATE iam.menus child SET parent_id = parent.id, updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'crm.marketing'
  AND child.code IN ('crm.campaigns', 'crm.promo');

UPDATE iam.menus child SET parent_id = parent.id, updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'crm.reports'
  AND child.code = 'sales-funnel.reports';

UPDATE iam.menus child SET parent_id = parent.id, updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'crm.settings'
  AND child.code = 'sales-funnel.settings';

-- ============================================================
-- 4. Perbaiki level seluruh subtree CRM (level = kedalaman dari root)
-- ============================================================
WITH RECURSIVE tree AS (
  SELECT id, 1 AS lvl FROM iam.menus WHERE code = 'crm'
  UNION ALL
  SELECT m.id, t.lvl + 1 FROM iam.menus m JOIN tree t ON m.parent_id = t.id
)
UPDATE iam.menus m SET level = t.lvl, updated_at = now()
FROM tree t WHERE t.id = m.id AND m.level IS DISTINCT FROM t.lvl;

-- ============================================================
-- 5. Grant menu baru: super_admin + sales (Accounts/Contacts), marketing (grup)
-- ============================================================
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'sales')
  AND m.code IN ('sales-funnel.accounts', 'sales-funnel.contacts')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'marketing', 'admin')
  AND m.code = 'crm.marketing'
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, updated_at = now();
