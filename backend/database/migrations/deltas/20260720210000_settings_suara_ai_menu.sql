-- EPIC-016 — menu Settings → Suara AI.
--
-- Diletakkan tepat setelah Integrasi karena isinya sejenis (kredensial layanan
-- AI), tetapi dipisah supaya provider suara bisa diganti tanpa menyentuh
-- konfigurasi teks/vision. Menu di bawahnya digeser satu langkah.
--
-- Izin disalin dari pemilik izin Integrasi: halaman ini memuat API key
-- Azure/ElevenLabs, jadi pembacanya harus sama terbatasnya.

UPDATE iam.menus
   SET order_number = order_number + 1, updated_at = now()
 WHERE code IN ('settings.payment-gateways', 'settings.appearance')
   AND deleted_at IS NULL;

INSERT INTO iam.menus (parent_id, code, menu_name, description, route_path, module, menu_type, icon, level, order_number)
SELECT
  parent.id,
  'settings.voice',
  'Suara AI',
  'Provider & suara text-to-speech untuk Interview AI, lengkap dengan preview',
  '/dashboard/settings/voice',
  'configuration',
  'sidebar',
  'megaphone',
  2,
  8
FROM iam.menus parent
WHERE parent.code = 'settings' AND parent.deleted_at IS NULL
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_menu_permissions (role_id, menu_id, is_active)
SELECT rmp.role_id, baru.id, true
  FROM iam.role_menu_permissions rmp
  JOIN iam.menus src ON src.id = rmp.menu_id AND src.code = 'settings.integrations'
  CROSS JOIN iam.menus baru
 WHERE baru.code = 'settings.voice'
   AND rmp.is_active
   AND NOT EXISTS (
     SELECT 1 FROM iam.role_menu_permissions ada
      WHERE ada.role_id = rmp.role_id AND ada.menu_id = baru.id
   );
