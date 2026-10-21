-- EPIC-067 T-067-A4 — Pengganti coach saat cuti.
--   • studio.coach_leave_covers: satu baris per (cuti, sesi terdampak).
--       open       butuh pengganti
--       requested  coach yang cuti meminta substitute_coach_id, menunggu jawaban
--                  sampai respond_by (lewat → kembali open)
--       accepted   pengganti menerima
--       assigned   Program Director menunjuk langsung
--       cancel     Program Director memutuskan kelas dibatalkan (cancel_reason)
--       void       cuti ditolak/dibatalkan, atau sesinya tidak lagi terdampak
--     Cuti coach baru bisa disetujui bila semua baris non-void sudah
--     accepted/assigned/cancel. Saat disetujui: coach sesi diganti (atau sesi
--     dibatalkan) dan applied_at diisi.
--   • class_sessions.original_coach_id: coach yang dijadwalkan sebelum diganti
--     pengganti; coach_id = yang benar-benar mengajar (dasar komisi & KPI).

CREATE TABLE IF NOT EXISTS studio.coach_leave_covers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  leave_id uuid NOT NULL REFERENCES hris.leaves(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES studio.class_sessions(id) ON DELETE CASCADE,
  original_coach_id uuid NOT NULL REFERENCES studio.coaches(id) ON DELETE CASCADE,
  substitute_coach_id uuid REFERENCES studio.coaches(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'requested', 'accepted', 'assigned', 'cancel', 'void')),
  requested_at timestamptz,
  respond_by timestamptz,
  responded_at timestamptz,
  decided_by uuid,
  cancel_reason text,
  note text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leave_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_coach_leave_covers_substitute ON studio.coach_leave_covers (substitute_coach_id, status);
CREATE INDEX IF NOT EXISTS idx_coach_leave_covers_branch_status ON studio.coach_leave_covers (branch_id, status);

ALTER TABLE studio.class_sessions
  ADD COLUMN IF NOT EXISTS original_coach_id uuid REFERENCES studio.coaches(id) ON DELETE SET NULL;
