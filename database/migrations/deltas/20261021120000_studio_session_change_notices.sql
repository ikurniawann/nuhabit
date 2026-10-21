-- EPIC-067 T-067-A6 — WA ke member saat coach diganti / kelas dibatalkan.
--   • member_notifications.kind: + session_coach_changed, session_cancelled;
--     session_id untuk laporan perubahan per sesi.
--   • class_sessions:
--       coach_changed_at   kapan coach terakhir diganti — booking yang dibuat
--                          SEBELUM waktu ini boleh batal tanpa penalti
--                          (kredit kembali) sampai kelas mulai
--       changed_at / change_kind   perubahan terakhir yang dikabarkan ke member
--       change_notice_late perubahan dikabarkan kurang dari minimal N jam
--                          sebelum kelas (pengaturan Cuti & Pengganti Coach)

ALTER TABLE studio.member_notifications DROP CONSTRAINT IF EXISTS member_notifications_kind_check;
ALTER TABLE studio.member_notifications
  ADD CONSTRAINT member_notifications_kind_check CHECK (kind IN (
    'session_reminder', 'waitlist_promoted', 'pass_low', 'pass_expiring',
    'session_coach_changed', 'session_cancelled'
  ));
ALTER TABLE studio.member_notifications
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES studio.class_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_studio_member_notifications_pending_change
  ON studio.member_notifications (created_at) WHERE status = 'pending' AND kind IN ('session_coach_changed', 'session_cancelled');

ALTER TABLE studio.class_sessions ADD COLUMN IF NOT EXISTS coach_changed_at timestamptz;
ALTER TABLE studio.class_sessions ADD COLUMN IF NOT EXISTS changed_at timestamptz;
ALTER TABLE studio.class_sessions ADD COLUMN IF NOT EXISTS change_kind varchar(20)
  CHECK (change_kind IN ('coach_changed', 'cancelled'));
ALTER TABLE studio.class_sessions ADD COLUMN IF NOT EXISTS change_notice_late boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_studio_class_sessions_changed ON studio.class_sessions (branch_id, changed_at DESC) WHERE changed_at IS NOT NULL;
