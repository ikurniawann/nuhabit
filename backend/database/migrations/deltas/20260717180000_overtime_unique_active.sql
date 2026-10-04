-- EPIC-008 Fase B (temuan review): cegah duplikat pengajuan lembur aktif
-- per (karyawan, tanggal) di level DB — pre-check aplikasi bisa balapan
-- (TOCTOU) dan lembur ganda akan terbayar dobel di payroll.
CREATE UNIQUE INDEX IF NOT EXISTS overtime_requests_active_unique
  ON hris.overtime_requests (employee_id, date)
  WHERE status IN ('pending', 'approved');
