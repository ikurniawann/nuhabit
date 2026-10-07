-- =============================================================================
-- EPIC-036 Fase F — Pengali lembur HARI LIBUR RESMI
--
-- PP 35/2021 membedakan tarif lembur hari kerja (1,5× upah sejam untuk jam
-- pertama) dari lembur di hari libur resmi (2× untuk jam-jam awal). Sebelum ini
-- sistem hanya punya SATU pengali rata, sehingga lembur tanggal merah dibayar
-- sama dengan lembur hari biasa.
--
-- Ditaruh di payroll_settings (bukan konstanta kode) mengikuti pola
-- overtime_multiplier yang sudah ada: kebijakan pengupahan harus bisa diubah
-- tanpa deploy. Default 2.00 = angka PP 35/2021.
--
-- ⚠ Yang TIDAK diterapkan delta ini: tangga progresif PP 35/2021 (hari libur
-- jam ke-8 → 3×, jam ke-9 dst → 4×; hari kerja jam ke-2 dst → 2×). Sistem tetap
-- memakai satu tarif rata per bucket seperti sebelumnya. Menerapkan tangga
-- penuh adalah keputusan kebijakan payroll tersendiri.
--
-- Idempoten: aman dijalankan ulang.
-- =============================================================================

ALTER TABLE hris.payroll_settings
    ADD COLUMN IF NOT EXISTS "overtime_multiplier_holiday" numeric(5,2) DEFAULT 2.0;

COMMENT ON COLUMN hris.payroll_settings.overtime_multiplier_holiday IS
    'Pengali upah lembur pada hari libur resmi (nasional/cuti bersama/perusahaan). PP 35/2021 = 2x. Lembur hari kerja memakai overtime_multiplier.';

-- Baris konfigurasi yang sudah ada dibuat eksplisit, bukan dibiarkan NULL:
-- NULL akan jatuh ke default kode dan menyembunyikan nilai yang sedang berlaku
-- dari halaman Pengaturan Payroll.
UPDATE hris.payroll_settings
   SET overtime_multiplier_holiday = 2.0
 WHERE overtime_multiplier_holiday IS NULL;
