-- Google sign-in for members: the verified Google subject linked to a
-- customer. One Google account maps to at most one member. Idempotent.

ALTER TABLE pos.pos_customers ADD COLUMN IF NOT EXISTS google_sub text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_customers_google_sub
  ON pos.pos_customers (google_sub) WHERE google_sub IS NOT NULL;
