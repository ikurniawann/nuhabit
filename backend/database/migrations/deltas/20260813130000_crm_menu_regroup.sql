-- =============================================================================
-- Reorganize CRM sidebar for clearer IA (mirror POS regroup style).
-- Idempotent.
--
-- Target tree:
--   Overview       → Dashboard
--   Customer Care  → Members, Inbox WhatsApp, Google Review
--   Loyalty        → Rewards, Avatars
--   Promo          → Promo (campaigns)          [NEW group wrapper]
--   Laporan        → Laporan CRM
--   Pengaturan     → Pengaturan CRM
-- =============================================================================

-- 1) Promo group under CRM
INSERT INTO iam.menus (
  code, menu_name, route_path, icon, menu_type, order_number,
  permission_context, module, level, is_active, is_visible
)
VALUES (
  'crm.promo',
  'Promo',
  NULL,
  'ticket',
  'group',
  40,
  '{"actions":["read"]}'::jsonb,
  'crm',
  1,
  true,
  true
)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number,
  module = EXCLUDED.module,
  level = EXCLUDED.level,
  is_active = true,
  is_visible = true,
  deleted_at = NULL,
  updated_at = now();

UPDATE iam.menus child
SET parent_id = parent.id,
    module = 'crm',
    level = 1,
    updated_at = now()
FROM iam.menus parent
WHERE child.code = 'crm.promo'
  AND parent.code = 'crm';

-- Grant crm.promo like crm.loyalty holders
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT rmp.role_id, promo.id, rmp.granted_actions
FROM iam.role_menu_permissions rmp
JOIN iam.menus loyalty ON loyalty.id = rmp.menu_id AND loyalty.code = 'crm.loyalty'
JOIN iam.menus promo ON promo.code = 'crm.promo'
WHERE rmp.is_active
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();

-- Move promo.campaigns under crm.promo
UPDATE iam.menus child
SET parent_id = parent.id,
    menu_name = 'Kampanye Promo',
    order_number = 10,
    is_active = true,
    is_visible = true,
    deleted_at = NULL,
    updated_at = now()
FROM iam.menus parent
WHERE child.code = 'promo.campaigns'
  AND parent.code = 'crm.promo';

-- 2) Top-level CRM group order
UPDATE iam.menus SET order_number = 10, menu_name = 'Overview', updated_at = now()
WHERE code = 'crm.overview';
UPDATE iam.menus SET order_number = 20, menu_name = 'Customer Care', updated_at = now()
WHERE code = 'crm.members';
UPDATE iam.menus SET order_number = 30, menu_name = 'Loyalty', updated_at = now()
WHERE code = 'crm.loyalty';
UPDATE iam.menus SET order_number = 40, updated_at = now()
WHERE code = 'crm.promo';
UPDATE iam.menus SET order_number = 50, menu_name = 'Laporan', updated_at = now()
WHERE code = 'crm.reports';
UPDATE iam.menus SET order_number = 60, menu_name = 'Pengaturan', updated_at = now()
WHERE code = 'crm.settings';

-- Keep inactive leftovers after Pengaturan (don't show)
UPDATE iam.menus SET order_number = 70, updated_at = now() WHERE code = 'crm.wallpapers';
UPDATE iam.menus SET order_number = 75, updated_at = now() WHERE code = 'crm.badges';
UPDATE iam.menus SET order_number = 5, updated_at = now() WHERE code = 'crm.campaigns';

-- 3) Children labels + order
UPDATE iam.menus SET menu_name = 'Dashboard', order_number = 10, updated_at = now()
WHERE code = 'crm.overview.dashboard';

UPDATE iam.menus SET menu_name = 'Members', order_number = 10, updated_at = now()
WHERE code = 'crm.members.list';
UPDATE iam.menus SET menu_name = 'Inbox WhatsApp', order_number = 20, updated_at = now()
WHERE code = 'crm.members.inbox';
UPDATE iam.menus SET menu_name = 'Google Review', order_number = 30, updated_at = now()
WHERE code = 'crm.members.reviews';

UPDATE iam.menus SET menu_name = 'Rewards', order_number = 10, updated_at = now()
WHERE code = 'crm.loyalty.rewards';
UPDATE iam.menus SET menu_name = 'Avatars', order_number = 20, updated_at = now()
WHERE code = 'crm.loyalty.avatars';

UPDATE iam.menus SET menu_name = 'Laporan CRM', order_number = 10, updated_at = now()
WHERE code = 'crm.reports.overview';

UPDATE iam.menus SET menu_name = 'Pengaturan CRM', order_number = 10, updated_at = now()
WHERE code = 'crm.settings.config';
