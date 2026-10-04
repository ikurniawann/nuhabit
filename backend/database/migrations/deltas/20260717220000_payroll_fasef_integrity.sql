-- EPIC-008 Fase F: integritas data payroll.
--   payroll_details selama ini TANPA FK (pola delete-before-insert manual).
--   1. Bersihkan baris yatim (run/karyawan sudah tidak ada).
--   2. FK payroll_run_id → payroll_runs ON DELETE CASCADE (hapus run =
--      hapus detailnya, menggantikan delete manual di API).
--   3. FK employee_id → employees ON DELETE RESTRICT (catatan finansial
--      tidak boleh ikut terhapus diam-diam saat karyawan dihapus).

DELETE FROM hris.payroll_details d
WHERE NOT EXISTS (SELECT 1 FROM hris.payroll_runs r WHERE r.id = d.payroll_run_id)
   OR NOT EXISTS (SELECT 1 FROM hris.employees e WHERE e.id = d.employee_id);

-- Catatan: DB dev ternyata SUDAH punya FK auto-named
-- (payroll_details_payroll_run_id_fkey ON DELETE CASCADE +
-- payroll_details_employee_id_fkey) yang tidak tercermin di file skema
-- introspeksi — kondisi dicek per-KOLOM agar tidak membuat duplikat.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'hris.payroll_details'::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'hris.payroll_details'::regclass
          AND attname = 'payroll_run_id'
      )]
  ) THEN
    ALTER TABLE hris.payroll_details
      ADD CONSTRAINT payroll_details_run_fk
      FOREIGN KEY (payroll_run_id) REFERENCES hris.payroll_runs(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'hris.payroll_details'::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'hris.payroll_details'::regclass
          AND attname = 'employee_id'
      )]
  ) THEN
    ALTER TABLE hris.payroll_details
      ADD CONSTRAINT payroll_details_employee_fk
      FOREIGN KEY (employee_id) REFERENCES hris.employees(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Index kolom FK TIDAK dibuat di sini — sudah ada dari skema dasar:
-- idx_payroll_details_run (payroll_run_id) & idx_payroll_details_employee
-- (employee_id) di 00000000000170_table_payroll_details.sql.
--
-- CATATAN DEPLOY: migrasi ini WAJIB diapply sebelum/bersamaan deploy kode
-- Fase F — endpoint DELETE run kini mengandalkan FK cascade (delete manual
-- payroll_details sudah dihapus dari API).
