-- Fix: menu ESS (Area Karyawan) sebelumnya hanya di-grant ke role
-- employee/hrd/hiring_manager, sehingga karyawan ber-role fungsional lain
-- (purchasing_manager, finance_staff, warehouse_staff, dll) tidak melihat
-- menu absensi/cuti/lembur/slip gaji/pinjaman miliknya sendiri.
--
-- SEMUA orang adalah karyawan → grant ESS ke SEMUA role. Aman: API ESS
-- menggate berdasarkan keterhubungan akun ke record hris.employees; akun
-- tanpa employee record hanya melihat pesan "tidak terhubung", bukan data.

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.deleted_at IS NULL
  AND m.code IN ('ess', 'ess.attendance', 'ess.leave', 'ess.overtime',
                 'ess.payroll', 'ess.loans')
  AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();
