-- Simpan faktor proraté cakupan kontrak di detail payroll agar slip gaji
-- bisa menampilkan keterangan prorata (mis. kontrak mulai tengah bulan).
-- 1 = periode penuh (tanpa proraté).
ALTER TABLE hris.payroll_details
  ADD COLUMN IF NOT EXISTS prorate_factor NUMERIC(9, 6) NOT NULL DEFAULT 1;

COMMENT ON COLUMN hris.payroll_details.prorate_factor IS
  'Faktor proraté cakupan kontrak (0..1); 1 = periode penuh. Dipakai slip utk keterangan prorata.';
