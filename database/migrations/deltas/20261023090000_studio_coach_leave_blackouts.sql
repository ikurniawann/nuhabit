-- EPIC-067 T-067-A2 — Tanggal blackout cuti coach.
--   • studio.coach_leave_blackouts: rentang tanggal (inklusif) + alasan per
--     venue, ditetapkan Program Director (menu studio.coach-leave). Pengajuan
--     cuti coach yang beririsan ditolak untuk jenis cuti yang "kena blackout"
--     (pengaturan per jenis di studio.settings leave_notice_rules.*.blackout),
--     kecuali coach meminta pengecualian.
--   • hris.leaves.blackout_override_*: pengecualian per pengajuan — wajib
--     diisi alasan oleh Program Director (approver cuti coach) saat menyetujui
--     cuti yang jatuh di masa blackout. Dicek ulang saat persetujuan, jadi
--     blackout yang dibuat sesudah pengajuan juga berlaku.

CREATE TABLE IF NOT EXISTS studio.coach_leave_blackouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  reason varchar(200) NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_leave_blackouts_range CHECK (date_to >= date_from AND date_to - date_from < 31)
);

CREATE INDEX IF NOT EXISTS idx_coach_leave_blackouts_branch ON studio.coach_leave_blackouts (branch_id, date_to);

ALTER TABLE hris.leaves ADD COLUMN IF NOT EXISTS blackout_exception_requested boolean NOT NULL DEFAULT false;
ALTER TABLE hris.leaves ADD COLUMN IF NOT EXISTS blackout_override_reason text;
ALTER TABLE hris.leaves ADD COLUMN IF NOT EXISTS blackout_override_by uuid;
ALTER TABLE hris.leaves ADD COLUMN IF NOT EXISTS blackout_override_at timestamptz;
