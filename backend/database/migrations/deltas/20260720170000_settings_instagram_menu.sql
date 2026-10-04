-- EPIC-013 Fase C — menu Settings → Instagram.
--
-- Diletakkan tepat setelah WhatsApp Gateway agar kedua kanal customer service
-- berdampingan; menu di bawahnya digeser satu langkah.
--
-- Izin diberikan HANYA kepada Super Admin, mengikuti WhatsApp Gateway:
-- halaman ini memuat App Secret dan Access Token.

-- Geser dulu yang berada di posisi 6 ke bawah agar urutannya tidak bentrok.
UPDATE iam.menus
   SET order_number = order_number + 1, updated_at = now()
 WHERE code IN ('settings.integrations', 'settings.payment-gateways', 'settings.appearance')
   AND deleted_at IS NULL;

INSERT INTO iam.menus (parent_id, code, menu_name, description, route_path, module, menu_type, icon, level, order_number)
SELECT
  parent.id,
  'settings.instagram',
  'Instagram',
  'Kredensial Instagram Messaging: webhook, App Secret, dan Access Token',
  '/dashboard/settings/instagram',
  'configuration',
  'sidebar',
  'megaphone',
  2,
  6
FROM iam.menus parent
WHERE parent.code = 'settings' AND parent.deleted_at IS NULL
ON CONFLICT (code) DO NOTHING;

-- Izin: samakan dengan pemilik izin WhatsApp Gateway (Super Admin).
INSERT INTO iam.role_menu_permissions (role_id, menu_id, is_active)
SELECT rmp.role_id, baru.id, true
  FROM iam.role_menu_permissions rmp
  JOIN iam.menus wa ON wa.id = rmp.menu_id AND wa.code = 'settings.wa_gateway'
  CROSS JOIN iam.menus baru
 WHERE baru.code = 'settings.instagram'
   AND rmp.is_active
   AND NOT EXISTS (
     SELECT 1 FROM iam.role_menu_permissions ada
      WHERE ada.role_id = rmp.role_id AND ada.menu_id = baru.id
   );
