-- EPIC-008 lanjutan — rincian cicilan pinjaman pada slip gaji.
--
-- Kolom `loan_deduction` hanya menyimpan TOTAL potongan, sehingga karyawan
-- tidak bisa tahu angsuran ke berapa dari berapa, atau pinjaman mana saja yang
-- dipotong bila ia punya lebih dari satu.
--
-- Rinciannya disimpan sebagai snapshot, BUKAN dihitung ulang saat slip dibuka:
-- saldo pinjaman terus berubah setiap periode, jadi menghitung ulang akan
-- membuat slip lama menampilkan angka yang berbeda dari saat diterbitkan.
-- Slip gaji adalah dokumen resmi — isinya harus tetap.

ALTER TABLE hris.payroll_details
  ADD COLUMN IF NOT EXISTS loan_details jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN hris.payroll_details.loan_details IS
  'Snapshot rincian cicilan pinjaman periode ini: array of {loan_id, loan_type, installment_no, tenor_months, amount, remaining_before, remaining_after}. Dibekukan saat payroll dihitung agar slip lama tidak berubah mengikuti saldo pinjaman terkini.';
