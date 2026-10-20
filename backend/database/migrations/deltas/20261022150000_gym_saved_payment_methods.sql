-- Saved payment methods for gym pass auto-renew, and renewal retries. Idempotent.
-- Card and e-wallet details stay at Xendit: the member links them on the
-- Xendit hosted page (Payment Session, session_type SAVE) and we keep the
-- payment token id, the channel and a masked label only.

-- 1. Saved methods -------------------------------------------------------------------
-- link_reference is our reference_id of the SAVE session (gympm_...);
-- xendit_customer_id is the Xendit customer the session created, reused on
-- the member's next link.
-- status: pending (hosted page open) -> active (token issued) -> canceled
-- (member unlinked) | expired (Xendit expired the token) | failed (linking
-- failed or the session expired).
CREATE TABLE IF NOT EXISTS gym.member_payment_methods (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE CASCADE,
  provider       text NOT NULL DEFAULT 'xendit',
  link_reference text NOT NULL UNIQUE,
  session_id     text,
  xendit_customer_id text,
  token_id       text UNIQUE,
  channel_code   text,
  method_type    text CHECK (method_type IN ('card', 'ewallet', 'other')),
  label          text,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'active', 'canceled', 'expired', 'failed')),
  failure_code   text,
  simulated      boolean NOT NULL DEFAULT false,
  linked_at      timestamptz,
  canceled_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_member_payment_methods_active_token CHECK (status <> 'active' OR token_id IS NOT NULL)
);

-- One active method per member: linking another needs an unlink first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_member_payment_methods_active
  ON gym.member_payment_methods (customer_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_gym_member_payment_methods_customer
  ON gym.member_payment_methods (customer_id, created_at DESC);

-- 2. Renewal retries --------------------------------------------------------------------
-- renewal_attempts counts the renewal payments tried for this pass;
-- renewal_retry_at is when the next one runs after the last failed or
-- expired; auto_renew_off_reason says why the system turned auto-renew off.
ALTER TABLE gym.member_passes
  ADD COLUMN IF NOT EXISTS renewal_attempts      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renewal_retry_at      timestamptz,
  ADD COLUMN IF NOT EXISTS auto_renew_off_reason text;

ALTER TABLE gym.member_passes DROP CONSTRAINT IF EXISTS gym_member_passes_renew_with_check;
ALTER TABLE gym.member_passes
  ADD CONSTRAINT gym_member_passes_renew_with_check CHECK (renew_with IN ('ark', 'invoice', 'saved_method'));

CREATE INDEX IF NOT EXISTS idx_gym_member_passes_renewal_retry
  ON gym.member_passes (renewal_retry_at) WHERE auto_renew AND renewal_retry_at IS NOT NULL;
