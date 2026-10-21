-- PT: ubah jadwal, pass yang mencakup PT, dan check-in PT di gate.
--
--   1. gym.pt_appointments.reschedule_count: berapa kali member memindahkan
--      sesinya sendiri (aturan ptRescheduleLimit).
--   2. gym.pt_participants.checked_in_at: member sudah scan di gate untuk
--      sesi ini; kredit PT dipotong saat itu, sweep tidak menandai tidak hadir.
--   3. gym.credit_packages.covers_personal: pass yang juga membayar sesi PT.
--      Pass tanpa tanda ini tetap hanya untuk kelas grup.
--   4. gym.access_logs: entry_kind 'pt' dan pt_participant_id untuk masuk
--      lewat janji PT.
--
-- Idempotent: aman dijalankan ulang.

ALTER TABLE gym.pt_appointments
  ADD COLUMN IF NOT EXISTS reschedule_count int NOT NULL DEFAULT 0 CHECK (reschedule_count >= 0);

ALTER TABLE gym.pt_participants ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

ALTER TABLE gym.credit_packages ADD COLUMN IF NOT EXISTS covers_personal boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN gym.credit_packages.covers_personal IS
  'Pass packages only: an active pass also covers personal training sessions.';

ALTER TABLE gym.access_logs
  ADD COLUMN IF NOT EXISTS pt_participant_id uuid REFERENCES gym.pt_participants (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_gym_access_logs_pt_participant
  ON gym.access_logs (pt_participant_id) WHERE pt_participant_id IS NOT NULL;

ALTER TABLE gym.access_logs DROP CONSTRAINT IF EXISTS access_logs_entry_kind_check;
ALTER TABLE gym.access_logs ADD CONSTRAINT access_logs_entry_kind_check
  CHECK (entry_kind IN ('booking', 're_entry', 'open_gym', 'pt'));
