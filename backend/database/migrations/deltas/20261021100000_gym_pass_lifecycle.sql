-- Gym pass lifecycle: freeze/unfreeze, auto-renew, admin extensions and
-- prorated refunds. Idempotent.

-- 1. Pass columns ---------------------------------------------------------------------
-- frozen_at/frozen_until: the running freeze (status 'frozen'); unfreezing
-- moves ends_at out by the frozen days and clears both.
-- auto_renew/renew_with: the member's renewal choice. renewal_handled_at is
-- set once the renewal sweep has acted on this pass (one renewal per pass).
ALTER TABLE gym.member_passes
  ADD COLUMN IF NOT EXISTS frozen_at           timestamptz,
  ADD COLUMN IF NOT EXISTS frozen_until        timestamptz,
  ADD COLUMN IF NOT EXISTS auto_renew          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS renew_with          text NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS renewal_handled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_purchase_id uuid REFERENCES gym.credit_purchases (id) ON DELETE SET NULL;

ALTER TABLE gym.member_passes DROP CONSTRAINT IF EXISTS member_passes_status_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_member_passes_status_check') THEN
    ALTER TABLE gym.member_passes
      ADD CONSTRAINT gym_member_passes_status_check CHECK (status IN ('active', 'frozen', 'expired', 'refunded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_member_passes_renew_with_check') THEN
    ALTER TABLE gym.member_passes
      ADD CONSTRAINT gym_member_passes_renew_with_check CHECK (renew_with IN ('ark', 'invoice'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_member_passes_frozen_check') THEN
    ALTER TABLE gym.member_passes
      ADD CONSTRAINT gym_member_passes_frozen_check
      CHECK (status <> 'frozen' OR (frozen_at IS NOT NULL AND frozen_until > frozen_at));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS member_passes_renewal_purchase_id_fk_idx ON gym.member_passes (renewal_purchase_id);
CREATE INDEX IF NOT EXISTS idx_gym_member_passes_frozen_until
  ON gym.member_passes (frozen_until) WHERE status = 'frozen';
CREATE INDEX IF NOT EXISTS idx_gym_member_passes_renewal_due
  ON gym.member_passes (ends_at) WHERE status = 'active' AND auto_renew AND renewal_handled_at IS NULL;

-- 2. Refunded amount (a pass refund can be prorated) ------------------------------------
ALTER TABLE gym.credit_purchases ADD COLUMN IF NOT EXISTS refunded_idr numeric(14,2);

-- 3. Pass event log -----------------------------------------------------------------------
-- days: freeze = planned days, unfreeze = days added to ends_at, extend =
-- days added. meta.charged_days on unfreeze is what counts toward the
-- yearly freeze allowance. actor_id is the staff user (NULL for the member
-- or the system).
CREATE TABLE IF NOT EXISTS gym.member_pass_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id     uuid NOT NULL REFERENCES gym.member_passes (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('freeze', 'unfreeze', 'extend', 'auto_renew', 'renewal')),
  days        integer,
  reason      text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gym_member_pass_events_pass ON gym.member_pass_events (pass_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gym_member_pass_events_customer
  ON gym.member_pass_events (customer_id, kind, created_at);
