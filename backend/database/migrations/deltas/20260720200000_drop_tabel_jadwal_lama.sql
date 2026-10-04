-- EPIC-015 Fase C: hapus tabel mati modul jadwal lama.
--
-- staff_schedules  = pola jadwal per staf (digantikan hris.employee_shifts)
-- staff_sections   = penghubung staf <-> section (UI-nya sudah dihapus Fase B)
--
-- SENGAJA TIDAK DIHAPUS:
--   staff    -> masih target FK purchase_returns.{created_by,approved_by},
--               vendor_credits.{created_by,approved_by}, employees.old_staff_id
--   sections -> masih target FK employees.section_id +
--               employment_history.{prev,new}_section_id, dan dipakai dropdown
--               Section di form karyawan lewat /api/sections
--
-- PENGAMAN: migrasi ini menolak jalan bila tabelnya ternyata berisi data.
-- Di dev keduanya 0 baris; bila di produksi ternyata ada isinya, migrasi GAGAL
-- dengan pesan jelas dan transaksinya di-rollback — bukan menghapus diam-diam.
-- Bila itu terjadi, hentikan Fase C dan putuskan bersama owner: arsipkan
-- (RENAME ... TO ..._deprecated) atau migrasikan datanya lebih dulu.
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_schedules', 'staff_sections'] LOOP
    IF to_regclass('hris.' || t) IS NULL THEN
      RAISE NOTICE 'hris.% sudah tidak ada, dilewati', t;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM hris.%I', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        'hris.% berisi % baris — migrasi dibatalkan. Tabel ini diasumsikan mati (0 baris di dev). Tinjau datanya dulu sebelum drop (lihat EPIC-015 Fase C).',
        t, n;
    END IF;
  END LOOP;
END $$;

-- Tanpa CASCADE: bila ternyata ada FK masuk yang tak terduga, biarkan gagal
-- keras daripada ikut menyeret objek lain.
DROP TABLE IF EXISTS hris.staff_schedules;
DROP TABLE IF EXISTS hris.staff_sections;
