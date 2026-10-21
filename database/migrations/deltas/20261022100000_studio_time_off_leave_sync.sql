-- EPIC-067 T-067-A5 — Cuti HRIS coach yang disetujui = time-off coach.
--   • coach_time_off.leave_id: time-off yang dibuat otomatis dari cuti HRIS
--     (hapus cuti / batalkan cuti → time-off ikut hilang). Time-off manual
--     (leave_id NULL) tetap seperti sebelumnya.
--   • Backfill: cuti coach yang sudah disetujui dan belum berakhir.

ALTER TABLE studio.coach_time_off
  ADD COLUMN IF NOT EXISTS leave_id uuid REFERENCES hris.leaves(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_coach_time_off_leave ON studio.coach_time_off (leave_id) WHERE leave_id IS NOT NULL;

INSERT INTO studio.coach_time_off (company_id, branch_id, coach_id, date_from, date_to, reason, leave_id)
SELECT c.company_id, c.branch_id, c.id, l.start_date, l.end_date, 'Cuti (HRIS)', l.id
FROM hris.leaves l
JOIN studio.coaches c ON c.employee_id = l.employee_id AND c.is_active
WHERE l.status = 'approved' AND l.end_date >= (now() AT TIME ZONE 'Asia/Jakarta')::date
ON CONFLICT DO NOTHING;
