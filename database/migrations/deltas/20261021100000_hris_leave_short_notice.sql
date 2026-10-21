-- EPIC-067 T-067-A1 — Minimal pemberitahuan cuti coach (H-N).
--   • is_short_notice: pengajuan di bawah minimal H-N untuk jenis cuti yang
--     boleh mendadak (sakit, darurat, …), atau dicatat HR untuk coach.
--   • notice_days: H-N saat diajukan (tanggal mulai − tanggal pengajuan WIB;
--     negatif = diajukan mundur). Dasar KPI disiplin cuti (T-067-A8).
-- Hanya diisi untuk karyawan yang terhubung ke coach studio aktif; karyawan
-- lain tetap NULL / false. Aturan per jenis cuti ada di studio.settings
-- (key leave_notice_rules), tanpa backfill untuk cuti lama.

ALTER TABLE hris.leaves ADD COLUMN IF NOT EXISTS is_short_notice boolean NOT NULL DEFAULT false;
ALTER TABLE hris.leaves ADD COLUMN IF NOT EXISTS notice_days integer;

CREATE INDEX IF NOT EXISTS idx_leaves_short_notice ON hris.leaves (employee_id, start_date) WHERE is_short_notice;

-- Form ESS & backoffice sudah menawarkan "Menikah" dan "Duka" (TS LeaveType),
-- tetapi enum DB belum → pengajuan dua jenis itu gagal disimpan. Ditambahkan
-- supaya aturan H-N per jenis cuti berlaku untuk keduanya. (PG ≥ 12: aman di
-- dalam transaksi selama nilai baru tidak dipakai di transaksi yang sama.)
ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'marriage';
ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'bereavement';
