-- Permintaan owner: menu Pinjaman pindah dari grup Penggajian ke
-- Kepegawaian (berdampingan dgn Shift Kerja & Lembur).
-- Rename kode IN-PLACE (pola migrasi 20260716140000) agar id baris &
-- role_menu_permissions tetap utuh; idempoten thd jalanan ulang.

UPDATE iam.menus
SET code = 'hris.kepegawaian.loans', level = 3, order_number = 50, updated_at = now()
WHERE code = 'hris.compensation.loans' AND deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM iam.menus WHERE code = 'hris.kepegawaian.loans');

UPDATE iam.menus stray
SET deleted_at = now(), is_active = false, is_visible = false, updated_at = now()
WHERE stray.code = 'hris.compensation.loans' AND stray.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM iam.menus WHERE code = 'hris.kepegawaian.loans');

UPDATE iam.menus child
SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'hris.kepegawaian.loans'
  AND parent.code = 'hris.kepegawaian';
