-- EPIC-011 lanjutan — menu CRM → Loyalty → Aturan XP.
--
-- Sebelumnya tidak ada UI sama sekali untuk crm_xp_rules, padahal tabelnya
-- menentukan apakah transaksi menghasilkan XP. Akibatnya tabel itu kosong dan
-- belanja di POS tidak menambah XP member.
--
-- Menu 'pos.loyalty.settings' (ARK & XP → /dashboard/pos/loyalty-settings)
-- SENGAJA tidak dipakai ulang: halamannya tidak pernah ada sehingga menu itu
-- mengarah ke 404, dan tempatnya pun keliru — aturan XP milik modul CRM,
-- sebaris dengan Rewards dan Avatars.

INSERT INTO iam.menus (parent_id, code, menu_name, description, route_path, module, menu_type, icon, level, order_number)
SELECT
  parent.id,
  'crm.loyalty.xp_rules',
  'Aturan XP',
  'Menentukan berapa XP yang diperoleh member dari tiap transaksi',
  '/dashboard/crm/xp-rules',
  'crm',
  'sidebar',
  'star',
  3,
  5                     -- sebelum Rewards & Avatars: aturan dulu, hadiah kemudian
FROM iam.menus parent
WHERE parent.code = 'crm.loyalty' AND parent.deleted_at IS NULL
ON CONFLICT (code) DO NOTHING;

-- Izin: samakan dengan pemilik izin menu Rewards (sesama modul Loyalty).
INSERT INTO iam.role_menu_permissions (role_id, menu_id, is_active)
SELECT rmp.role_id, baru.id, true
  FROM iam.role_menu_permissions rmp
  JOIN iam.menus rewards ON rewards.id = rmp.menu_id AND rewards.code = 'crm.loyalty.rewards'
  CROSS JOIN iam.menus baru
 WHERE baru.code = 'crm.loyalty.xp_rules'
   AND rmp.is_active
   AND NOT EXISTS (
     SELECT 1 FROM iam.role_menu_permissions ada
      WHERE ada.role_id = rmp.role_id AND ada.menu_id = baru.id
   );

-- Menu mati: halaman /dashboard/pos/loyalty-settings dan /dashboard/pos/topup
-- tidak pernah dibuat, sehingga keduanya hanya mengantar pengguna ke 404.
-- Disembunyikan, bukan dihapus, agar mudah dikembalikan bila halamannya
-- memang akan dibuat nanti.
UPDATE iam.menus
   SET is_visible = false, updated_at = now()
 WHERE code IN ('pos.loyalty.settings', 'pos.loyalty.topup')
   AND deleted_at IS NULL;
