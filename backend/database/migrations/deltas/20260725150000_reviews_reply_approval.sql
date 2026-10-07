-- EPIC-013 — approval supervisor untuk balasan ulasan bintang rendah.
--
-- Balasan Google tampil publik = wajah bisnis. Untuk ulasan ber-rating <= 2,
-- balasan dari agent TIDAK langsung dikirim ke Google — disimpan dulu sebagai
-- draft menunggu persetujuan (pending_approval). Role approver
-- (super_admin/admin) menyetujui (baru dikirim ke Google) atau menolak.
--
-- `status` lama (baru|dibalas|diabaikan) sengaja TIDAK ditambah nilai baru:
-- selama menunggu persetujuan ulasan secara publik memang BELUM dibalas,
-- jadi tetap 'baru' dan SLA terus berjalan. Status approval hidup di kolom
-- terpisah `reply_approval_status`.

ALTER TABLE crm.google_reviews
  ADD COLUMN IF NOT EXISTS pending_reply_comment text,
  ADD COLUMN IF NOT EXISTS pending_reply_user_id uuid,
  ADD COLUMN IF NOT EXISTS pending_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_approval_status text,
  ADD COLUMN IF NOT EXISTS reply_approved_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS reply_approved_at timestamptz;

ALTER TABLE crm.google_reviews
  DROP CONSTRAINT IF EXISTS google_reviews_reply_approval_check;
ALTER TABLE crm.google_reviews
  ADD CONSTRAINT google_reviews_reply_approval_check
  CHECK (
    reply_approval_status IS NULL
    OR reply_approval_status = ANY (ARRAY['pending_approval', 'approved', 'rejected'])
  );

ALTER TABLE crm.google_reviews
  DROP CONSTRAINT IF EXISTS google_reviews_pending_reply_len;
ALTER TABLE crm.google_reviews
  ADD CONSTRAINT google_reviews_pending_reply_len
  CHECK (pending_reply_comment IS NULL OR char_length(pending_reply_comment) <= 4000);

-- Antrean persetujuan untuk approver.
CREATE INDEX IF NOT EXISTS google_reviews_pending_approval_idx
  ON crm.google_reviews (pending_reply_at)
  WHERE reply_approval_status = 'pending_approval';

COMMENT ON COLUMN crm.google_reviews.pending_reply_comment IS
  'Draft balasan yang menunggu persetujuan; dipertahankan saat ditolak agar agent bisa merevisi.';
COMMENT ON COLUMN crm.google_reviews.reply_approval_status IS
  'pending_approval | approved | rejected — hanya dipakai untuk balasan ulasan bintang rendah.';
