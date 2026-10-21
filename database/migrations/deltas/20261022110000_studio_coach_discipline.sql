-- EPIC-067 T-067-A8 — Disiplin coach: catatan ketidakhadiran, potongan
-- komisi, dan usulan SP (keputusan client no. 3: ketiganya aktif bersamaan).
--   • studio.coach_incidents: tidak hadir tanpa kabar / cuti mendadak / terlambat.
--       deduction_percent = snapshot aturan saat dicatat (aturan berubah tidak
--       mengubah catatan lama); void = dibatalkan Program Director dengan alasan.
--       Cuti mendadak dicatat otomatis saat cuti mendadak disetujui (unik per cuti).
--   • studio.coach_warnings: usulan SP otomatis setelah N kejadian dalam X hari;
--       Program Director menerbitkan (issued) atau mengabaikan (dismissed).
--   • commission_lines: gross_amount (sebelum potongan), deduction_percent,
--       deduction_amount; amount = bersih yang dibayar.

CREATE TABLE IF NOT EXISTS studio.coach_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  coach_id uuid NOT NULL REFERENCES studio.coaches(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL CHECK (kind IN ('no_show', 'short_notice_leave', 'late')),
  occurred_on date NOT NULL,
  session_id uuid REFERENCES studio.class_sessions(id) ON DELETE SET NULL,
  leave_id uuid REFERENCES hris.leaves(id) ON DELETE CASCADE,
  minutes_late integer CHECK (minutes_late IS NULL OR minutes_late > 0),
  note text,
  deduction_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (deduction_percent BETWEEN 0 AND 100),
  status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
  void_reason text,
  voided_by uuid,
  voided_at timestamptz,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_coach_incidents_coach ON studio.coach_incidents (coach_id, occurred_on) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_studio_coach_incidents_branch ON studio.coach_incidents (branch_id, occurred_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_coach_incidents_leave ON studio.coach_incidents (leave_id) WHERE leave_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS studio.coach_warnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  coach_id uuid NOT NULL REFERENCES studio.coaches(id) ON DELETE CASCADE,
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  status varchar(10) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'issued', 'dismissed')),
  window_from date NOT NULL,
  window_to date NOT NULL,
  incident_ids uuid[] NOT NULL,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Paling banyak satu usulan terbuka per coach.
CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_coach_warnings_proposed ON studio.coach_warnings (coach_id) WHERE status = 'proposed';

ALTER TABLE studio.commission_lines ADD COLUMN IF NOT EXISTS gross_amount numeric(14,2);
ALTER TABLE studio.commission_lines ADD COLUMN IF NOT EXISTS deduction_percent numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE studio.commission_lines ADD COLUMN IF NOT EXISTS deduction_amount numeric(14,2) NOT NULL DEFAULT 0;
UPDATE studio.commission_lines SET gross_amount = amount WHERE gross_amount IS NULL;
