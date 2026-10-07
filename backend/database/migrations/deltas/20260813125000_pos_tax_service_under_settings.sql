-- Move Tax & Service (settings.billing) under POS → Pengaturan.
-- Route tetap /dashboard/settings/billing. Idempotent.

UPDATE iam.menus child
SET parent_id = parent.id,
    menu_name = 'Tax & Service',
    route_path = '/dashboard/settings/billing',
    order_number = 15,
    module = 'pos',
    level = 2,
    is_active = true,
    is_visible = true,
    deleted_at = NULL,
    updated_at = now()
FROM iam.menus parent
WHERE child.code = 'settings.billing'
  AND parent.code = 'pos.settings';

-- Pengaturan order: Metode Bayar → Tax & Service → ARK & XP → Printer
UPDATE iam.menus SET order_number = 10, updated_at = now()
WHERE code = 'pos.loyalty.payment-methods';
UPDATE iam.menus SET order_number = 15, updated_at = now()
WHERE code = 'settings.billing';
UPDATE iam.menus SET order_number = 20, updated_at = now()
WHERE code = 'pos.loyalty.settings';
UPDATE iam.menus SET order_number = 30, updated_at = now()
WHERE code = 'pos.kitchen.printer-settings';

-- Pastikan role yang punya akses POS Pengaturan juga bisa lihat Tax & Service
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT rmp.role_id, billing.id, COALESCE(rmp.granted_actions, '["read","update"]'::jsonb)
FROM iam.role_menu_permissions rmp
JOIN iam.menus settings ON settings.id = rmp.menu_id AND settings.code = 'pos.settings'
JOIN iam.menus billing ON billing.code = 'settings.billing'
WHERE rmp.is_active
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  updated_at = now();
