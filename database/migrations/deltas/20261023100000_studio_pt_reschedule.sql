-- EPIC-067 T-067-A7 — Reschedule sesi Personal Training tanpa batal-lalu-booking.
--   • Sesi dipindah DI TEMPAT (tanggal/jam, dan coach bila oleh admin):
--     booking & kredit pass tetap menempel ke sesi yang sama → kredit tidak
--     berubah, komisi & check-in tetap jalan normal.
--   • studio.pt_reschedules: riwayat per perpindahan (siapa, dari → ke,
--     alasan). Dasar batas jumlah reschedule oleh member (Aturan Booking
--     pt_member_reschedule_max).
--   • class_sessions.studio_rescheduled_at: dipindah coach/admin — booking
--     yang dibuat sebelumnya boleh batal tanpa penalti sampai sesi mulai
--     (sama dengan coach diganti, T-067-A6).
--   • Kabar ke member lewat antrean member_notifications (kind
--     session_rescheduled; jam tenang & tanda terlambat seperti A6), dan
--     change_kind 'rescheduled' supaya masuk laporan perubahan jadwal.

CREATE TABLE IF NOT EXISTS studio.pt_reschedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES studio.class_sessions(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES studio.bookings(id) ON DELETE CASCADE,
  from_date date NOT NULL,
  from_start time NOT NULL,
  from_coach_id uuid,
  to_date date NOT NULL,
  to_start time NOT NULL,
  to_coach_id uuid,
  actor_kind varchar(10) NOT NULL CHECK (actor_kind IN ('member', 'coach', 'staff')),
  actor_user_id uuid,
  reason varchar(300),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pt_reschedules_booking ON studio.pt_reschedules (booking_id, created_at);

ALTER TABLE studio.class_sessions ADD COLUMN IF NOT EXISTS studio_rescheduled_at timestamptz;

ALTER TABLE studio.member_notifications DROP CONSTRAINT IF EXISTS member_notifications_kind_check;
ALTER TABLE studio.member_notifications
  ADD CONSTRAINT member_notifications_kind_check CHECK (kind IN (
    'session_reminder', 'waitlist_promoted', 'pass_low', 'pass_expiring',
    'session_coach_changed', 'session_cancelled', 'session_rescheduled'
  ));
DROP INDEX IF EXISTS studio.idx_studio_member_notifications_pending_change;
CREATE INDEX IF NOT EXISTS idx_studio_member_notifications_pending_change
  ON studio.member_notifications (created_at)
  WHERE status = 'pending' AND kind IN ('session_coach_changed', 'session_cancelled', 'session_rescheduled');

ALTER TABLE studio.class_sessions DROP CONSTRAINT IF EXISTS class_sessions_change_kind_check;
ALTER TABLE studio.class_sessions
  ADD CONSTRAINT class_sessions_change_kind_check CHECK (change_kind IN ('coach_changed', 'cancelled', 'rescheduled'));
