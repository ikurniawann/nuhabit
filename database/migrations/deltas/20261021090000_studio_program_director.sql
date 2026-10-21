-- EPIC-067 T-067-A9 — Role Program Director & menu Cuti & Pengganti Coach.
--   • role `program_director`: menyetujui cuti coach, menunjuk pengganti,
--     membatalkan kelas, mengatur blackout (alur di T-067-A4/A2).
--   • menu `studio.coach-leave` (/dashboard/studio/coach-leave): pengaturan
--     approver cadangan; hak memutus cuti ditentukan oleh role, bukan aksi menu.
--   • CHECK `users_role_check` dibangun ulang: tambah `program_director` dan
--     sertakan employee/sales/marketing yang sudah ada di UI & seeder HRIS
--     tetapi belum ada di CHECK skema (gagal saat user diberi role itu).

-- ── 1. CHECK role user ──────────────────────────────────────────────────
ALTER TABLE configuration.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE configuration.users
  ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
    'super_admin'::text, 'admin'::text, 'hrd'::text, 'hiring_manager'::text, 'direksi'::text,
    'purchasing_admin'::text, 'purchasing_manager'::text, 'purchasing_staff'::text,
    'finance_staff'::text, 'warehouse_staff'::text, 'warehouse_admin'::text,
    'pos'::text, 'pos_supervisor'::text, 'qc_staff'::text,
    'employee'::text, 'sales'::text, 'marketing'::text,
    'program_director'::text
  ]));

-- ── 2. Role ─────────────────────────────────────────────────────────────
INSERT INTO iam.roles (code, name, description)
VALUES ('program_director', 'Program Director',
        'Menyetujui cuti coach, menunjuk pengganti, membatalkan kelas, mengatur blackout cuti')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  is_active = true, deleted_at = NULL, updated_at = now();

-- ── 3. Menu ─────────────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('studio.coach-leave', 'Cuti & Pengganti Coach', '/dashboard/studio/coach-leave', 'clipboard-document-check',
        'sidebar', 47, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'studio', level = 2 WHERE code = 'studio.coach-leave';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'studio.coach-leave' AND parent.code = 'studio';

-- ── 4. Permission ───────────────────────────────────────────────────────
-- Admin: menu baru dengan semua aksinya.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb), true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'direksi') AND m.code = 'studio.coach-leave'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- Program Director: kelola menu baru + lihat/ubah jadwal & ketersediaan coach
-- (untuk menunjuk pengganti dan membatalkan kelas) + area karyawan sendiri.
-- Aksi dibatasi ke read/update dari yang ditawarkan tiap menu.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id,
       COALESCE((SELECT jsonb_agg(a) FROM jsonb_array_elements_text(COALESCE(m.permission_context->'actions', '["read"]'::jsonb)) a
                 WHERE a = 'read' OR (a = 'update' AND m.code <> 'studio.coaches')), '["read"]'::jsonb),
       true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'program_director'
  AND m.deleted_at IS NULL
  AND m.code IN ('studio', 'studio.coach-leave', 'studio.schedule', 'studio.calendar', 'studio.coaches',
                 'studio.availability', 'studio.pt', 'studio.attendance', 'ess')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
