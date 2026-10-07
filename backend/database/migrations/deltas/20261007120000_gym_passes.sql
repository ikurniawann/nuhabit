-- Gym passes: a package kind that grants unlimited bookings for validity_days,
-- a public flag and badge for the price list, per-branch prices, the member
-- passes issued by a paid purchase, and a strike flag on bookings for late
-- cancels by pass holders. Idempotent.

-- 1. Package kind, public flag, badge -------------------------------------------
ALTER TABLE gym.credit_packages
  ADD COLUMN IF NOT EXISTS kind      text NOT NULL DEFAULT 'credits',
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS badge     text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_credit_packages_kind_check') THEN
    ALTER TABLE gym.credit_packages
      ADD CONSTRAINT gym_credit_packages_kind_check CHECK (kind IN ('credits', 'pass'));
  END IF;
END $$;

-- A pass carries no credits: credits 0 is allowed for kind 'pass' only.
ALTER TABLE gym.credit_packages DROP CONSTRAINT IF EXISTS credit_packages_credits_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_credit_packages_credits_check') THEN
    ALTER TABLE gym.credit_packages
      ADD CONSTRAINT gym_credit_packages_credits_check CHECK (credits > 0 OR (kind = 'pass' AND credits = 0));
  END IF;
END $$;

-- A pass purchase records 0 credits.
ALTER TABLE gym.credit_purchases DROP CONSTRAINT IF EXISTS credit_purchases_credits_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_credit_purchases_credits_check') THEN
    ALTER TABLE gym.credit_purchases
      ADD CONSTRAINT gym_credit_purchases_credits_check CHECK (credits >= 0);
  END IF;
END $$;

-- 2. Per-branch prices ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.package_branch_prices (
  package_id uuid NOT NULL REFERENCES gym.credit_packages (id) ON DELETE CASCADE,
  branch_id  uuid NOT NULL REFERENCES configuration.branches (id) ON DELETE CASCADE,
  price_idr  numeric(14,2) NOT NULL CHECK (price_idr >= 0),
  PRIMARY KEY (package_id, branch_id)
);

-- 3. Member passes -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.member_passes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE RESTRICT,
  package_id  uuid NOT NULL REFERENCES gym.credit_packages (id) ON DELETE RESTRICT,
  purchase_id uuid REFERENCES gym.credit_purchases (id) ON DELETE RESTRICT,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'refunded')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_member_passes_period CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_gym_member_passes_customer ON gym.member_passes (customer_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_member_passes_purchase
  ON gym.member_passes (purchase_id) WHERE purchase_id IS NOT NULL;

-- 4. Pass strikes: a late cancel or no-show by a pass holder ---------------------------
ALTER TABLE gym.bookings ADD COLUMN IF NOT EXISTS pass_strike boolean NOT NULL DEFAULT false;

-- 5. Seed the public passes (placeholder prices) ---------------------------------------
INSERT INTO gym.credit_packages (name, description, kind, credits, price_idr, validity_days, badge, sort_order)
SELECT v.name, v.description, 'pass', 0, v.price_idr, v.validity_days, v.badge, v.sort_order
FROM (VALUES
  ('Pass 4 Minggu', 'Booking kelas tanpa batas selama 4 minggu.', 1200000::numeric, 28, NULL::text, 110),
  ('Pass 8 Minggu', 'Booking kelas tanpa batas selama 8 minggu.', 2200000::numeric, 56, 'Paling laris', 120),
  ('Pass 6 Bulan', 'Booking kelas tanpa batas selama 6 bulan.', 5400000::numeric, 182, NULL::text, 130),
  ('Holiday Pass 1 Minggu', 'Latihan tanpa batas selama seminggu, cocok saat berkunjung.', 400000::numeric, 7, NULL::text, 140)
) AS v(name, description, price_idr, validity_days, badge, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM gym.credit_packages p WHERE p.name = v.name);
