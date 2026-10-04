-- Snapshot gaji pokok PENUH (sebelum proraté) di detail payroll agar slip
-- bisa menampilkan "gaji pokok sebenarnya" + persen potongan prorata tanpa
-- derivasi pembagian yang rawan pembulatan. NULL utk baris lama (fallback
-- derive base_salary / prorate_factor di tampilan).
ALTER TABLE hris.payroll_details
  ADD COLUMN IF NOT EXISTS full_base_salary NUMERIC(15, 2);

COMMENT ON COLUMN hris.payroll_details.full_base_salary IS
  'Gaji pokok penuh sebelum proraté cakupan kontrak; NULL pada baris sebelum kolom ini ada.';
