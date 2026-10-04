-- EPIC-022 Fase C: Aktivitas, Follow-up & Pengingat WA — menu "Follow-up
-- Hari Ini" (super_admin+sales) + seed template pesan WA global.
-- Tabel crm_sales_activities & crm_sales_wa_templates sudah dibuat Fase A.

-- ============================================================
-- 1. Menu: Follow-up Hari Ini
-- ============================================================
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('sales-funnel.followups', 'Follow-up Hari Ini', '/dashboard/sales-funnel/followups',
        'check-circle', 'sidebar', 30, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'sales-funnel', level = 2 WHERE code = 'sales-funnel.followups';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'sales-funnel.followups' AND parent.code = 'sales-funnel';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'sales')
  AND m.code = 'sales-funnel.followups'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- ============================================================
-- 2. Seed template pesan WA global (company_id NULL = semua venue).
--    Placeholder: {pic} {instansi} {acara} {tanggal_acara} {venue}
-- ============================================================
INSERT INTO crm.crm_sales_wa_templates (name, body)
SELECT * FROM (VALUES
  ('Follow-up Penawaran',
   'Halo {pic}, terima kasih sudah menghubungi kami terkait rencana {acara} untuk {instansi}. Apakah ada yang bisa kami bantu jelaskan dari penawaran yang sudah kami kirim? 🙏'),
  ('Konfirmasi Survey Lokasi',
   'Halo {pic}, menindaklanjuti rencana {acara} {instansi}, kami ingin mengundang Bapak/Ibu untuk survey lokasi. Kapan waktu yang nyaman untuk berkunjung?'),
  ('Pengingat Jadwal Acara',
   'Halo {pic}, mengingatkan kembali jadwal {acara} {instansi} pada {tanggal_acara}. Sampai jumpa! 🎉')
) AS seed(name, body)
WHERE NOT EXISTS (
  SELECT 1 FROM crm.crm_sales_wa_templates t
  WHERE t.name = seed.name AND t.company_id IS NULL
);
