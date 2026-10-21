-- =============================================================================
-- Gym credit transfer reclaims
-- =============================================================================
-- Staff can take a transfer back while the receiver's linked lot is still
-- unused, so a sender's purchase can be refunded whole. The credits taken
-- back per moved lot accumulate in gym.credit_transfer_lots.reclaimed_credits;
-- the ledger carries the moves themselves (source_type = 'transfer_reclaim',
-- source_id = the transfer). Idempotent.
-- =============================================================================

ALTER TABLE gym.credit_transfer_lots
  ADD COLUMN IF NOT EXISTS reclaimed_credits integer NOT NULL DEFAULT 0;

ALTER TABLE gym.credit_transfer_lots DROP CONSTRAINT IF EXISTS credit_transfer_lots_reclaimed_within_credits;
ALTER TABLE gym.credit_transfer_lots ADD CONSTRAINT credit_transfer_lots_reclaimed_within_credits
  CHECK (reclaimed_credits >= 0 AND reclaimed_credits <= credits);

COMMENT ON COLUMN gym.credit_transfer_lots.reclaimed_credits IS
  'Kredit yang ditarik kembali staf dari lot penerima ke lot pengirim (entri ledger transfer_reclaim).';
