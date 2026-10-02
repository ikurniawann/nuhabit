-- =============================================================================
-- Buka Member App tanpa OTP oleh staf (preview) — hanya aktif bila server
-- MEMBER_PREVIEW_ENABLED=1 (dinyalakan di DEV). Setiap pemakaian dicatat.
-- =============================================================================
CREATE TABLE IF NOT EXISTS studio.member_preview_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  staff_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_member_preview_log ON studio.member_preview_log(created_at DESC);
