-- EPIC-007 lanjutan — kelompokkan menu pengajuan ESS ke dalam satu induk.
--
-- Izin & Cuti, Lembur, dan Pinjaman sebelumnya sejajar dengan Absensi, Slip
-- Gaji, dan KPI, padahal ketiganya adalah hal yang sama: pengajuan yang
-- menunggu keputusan. Dikelompokkan agar Area Karyawan tidak menjadi daftar
-- datar yang panjang.
--
-- Induk sengaja TIDAK diberi baris role_menu_permissions: get-user-menus
-- menarik seluruh leluhur dari menu yang diizinkan (includeAncestorMenus),
-- sehingga induk ikut tampil selama salah satu anaknya berizin — dan hilang
-- dengan sendirinya bila tidak ada satu pun anak yang boleh diakses.

INSERT INTO iam.menus (parent_id, code, menu_name, description, route_path, module, menu_type, icon, level, order_number)
SELECT
  parent.id,
  'ess.requests',
  'Pengajuan',
  'Pengajuan karyawan: izin & cuti, lembur, dan pinjaman',
  NULL,                 -- induk murni wadah; tanpa halaman sendiri
  'ess',
  'group',
  'paper-airplane',
  2,
  20                    -- menempati posisi Izin & Cuti yang lama
FROM iam.menus parent
WHERE parent.code = 'ess' AND parent.deleted_at IS NULL
ON CONFLICT (code) DO NOTHING;

-- Pindahkan ketiga menu pengajuan ke bawah induk baru.
UPDATE iam.menus child
   SET parent_id = parent.id,
       level = 3,
       order_number = urut.order_number,
       updated_at = now()
  FROM iam.menus parent,
       (VALUES ('ess.leave', 10), ('ess.overtime', 20), ('ess.loans', 30))
         AS urut(code, order_number)
 WHERE parent.code = 'ess.requests'
   AND child.code = urut.code
   AND child.deleted_at IS NULL;
