-- EPIC-067 T-067-C4 — Catatan coach setelah sesi per member.
--   • studio.member_session_notes: catatan coach untuk satu member di satu sesi
--     yang ia pegang (mis. "hindari lunges, lutut kiri"). carry_forward = "bawa
--     ke sesi berikutnya": tampil di roster coach mana pun yang mengajar member
--     itu sampai dilepas (released_*). Catatan lain tampil sebagai riwayat
--     singkat (60 hari terakhir).
--   • Hanya di Coach Portal (bisa berisi info kesehatan → keputusan client
--     no. 9), tidak pernah dikirim ke API backoffice.
--   • Hapus = removed_at (hanya penulisnya).

CREATE TABLE IF NOT EXISTS studio.member_session_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  session_id uuid REFERENCES studio.class_sessions(id) ON DELETE SET NULL,
  coach_id uuid NOT NULL REFERENCES studio.coaches(id) ON DELETE CASCADE,
  body varchar(500) NOT NULL,
  carry_forward boolean NOT NULL DEFAULT true,
  released_at timestamptz,
  released_by_coach_id uuid REFERENCES studio.coaches(id) ON DELETE SET NULL,
  removed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_session_notes_customer ON studio.member_session_notes (customer_id, created_at DESC) WHERE removed_at IS NULL;
