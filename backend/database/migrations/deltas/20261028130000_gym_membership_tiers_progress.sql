-- =============================================================================
-- Gym membership tiers from 12-month spending (EPIC-069) and attendance
-- progress (EPIC-066). The gym-loyalty module owns these tables.
--
-- Two ladders live side by side:
--   * Membership (this file): tiers the client defines by rupiah spent over
--     the last 365 days on gym purchases, POS orders and shop orders, net of
--     refunds. A tier carries the perks the system applies: POS/F&B discount,
--     earlier booking, its own late-cancel window and waitlist priority, plus
--     free-text perks staff fulfil. Deliberately not seeded: the client fills
--     the ladder.
--   * Progress (crm.crm_membership_tiers, unchanged): tiers by lifetime XP.
--     Attendance now earns XP too. Its only perk is discount_percent.
-- When both ladders give the same perk the member gets the better one.
--
-- Member status (active, suspended until a date, banned) is set by managers
-- with a reason and an audit trail: suspended freezes tier perks, XP and the
-- leaderboard until the date; banned also stops booking and gate entry.
-- Idempotent.
-- =============================================================================

-- 1. Tier ladder ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.membership_tiers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  color               text CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  -- Rupiah spent in the last 365 days to reach the tier.
  min_spend_idr       numeric(14,2) NOT NULL CHECK (min_spend_idr >= 0),
  -- POS, self-order and F&B discount.
  discount_percent    numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  -- Days added to bookingOpensDaysBefore.
  early_booking_days  integer NOT NULL DEFAULT 0 CHECK (early_booking_days BETWEEN 0 AND 14),
  -- Late-cancel window in hours; NULL follows the branch rule, and a value
  -- applies only when it is shorter than the branch rule.
  cancel_window_hours integer CHECK (cancel_window_hours BETWEEN 0 AND 72),
  -- Promoted from the waitlist before members of lower tiers.
  waitlist_priority   boolean NOT NULL DEFAULT false,
  -- Perks staff fulfil (guest pass, merchandise), shown in the member app.
  perks               text[] NOT NULL DEFAULT '{}',
  is_active           boolean NOT NULL DEFAULT true,
  created_by          uuid,
  updated_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_membership_tiers_spend
  ON gym.membership_tiers (min_spend_idr) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_membership_tiers_name
  ON gym.membership_tiers (lower(btrim(name))) WHERE is_active;

-- 2. Each member's tier ----------------------------------------------------------
-- valid_until: the tier holds until this date even when spending drops
-- (tier_hold_months after the member last qualified). spend_12m is the
-- spending at the last evaluation, evaluated_on its Jakarta date.
CREATE TABLE IF NOT EXISTS gym.member_memberships (
  customer_id  uuid PRIMARY KEY REFERENCES pos.pos_customers (id) ON DELETE CASCADE,
  tier_id      uuid REFERENCES gym.membership_tiers (id) ON DELETE SET NULL,
  valid_until  date,
  spend_12m    numeric(14,2) NOT NULL DEFAULT 0,
  evaluated_on date NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_member_memberships_tier ON gym.member_memberships (tier_id);
CREATE INDEX IF NOT EXISTS idx_gym_member_memberships_evaluated ON gym.member_memberships (evaluated_on);

-- 3. Tier history ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym.membership_tier_changes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE CASCADE,
  from_tier_id   uuid REFERENCES gym.membership_tiers (id) ON DELETE SET NULL,
  to_tier_id     uuid REFERENCES gym.membership_tiers (id) ON DELETE SET NULL,
  from_tier_name text,
  to_tier_name   text,
  direction      text NOT NULL CHECK (direction IN ('up', 'down')),
  spend_12m      numeric(14,2) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_membership_tier_changes_customer
  ON gym.membership_tier_changes (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS membership_tier_changes_from_tier_id_fk_idx ON gym.membership_tier_changes (from_tier_id);
CREATE INDEX IF NOT EXISTS membership_tier_changes_to_tier_id_fk_idx ON gym.membership_tier_changes (to_tier_id);

-- 4. Settings: tier hold and XP values, one row ------------------------------------
CREATE TABLE IF NOT EXISTS gym.loyalty_settings (
  id                         boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Months a tier holds after the member last qualified.
  tier_hold_months           integer NOT NULL DEFAULT 12 CHECK (tier_hold_months BETWEEN 0 AND 36),
  xp_class_attended          integer NOT NULL DEFAULT 50 CHECK (xp_class_attended BETWEEN 0 AND 10000),
  xp_pt_attended             integer NOT NULL DEFAULT 80 CHECK (xp_pt_attended BETWEEN 0 AND 10000),
  -- Extra XP for a class that starts inside the branch's off-peak hours.
  xp_offpeak_bonus           integer NOT NULL DEFAULT 20 CHECK (xp_offpeak_bonus BETWEEN 0 AND 10000),
  -- Once per ISO week with at least weekly_streak_min_sessions attended.
  xp_weekly_streak           integer NOT NULL DEFAULT 100 CHECK (xp_weekly_streak BETWEEN 0 AND 10000),
  weekly_streak_min_sessions integer NOT NULL DEFAULT 3 CHECK (weekly_streak_min_sessions BETWEEN 1 AND 14),
  -- On every fourth week in a row of weekly streaks.
  xp_streak_4w               integer NOT NULL DEFAULT 300 CHECK (xp_streak_4w BETWEEN 0 AND 10000),
  -- Package purchase: xp_purchase_per_step XP per purchase_step_idr paid.
  xp_purchase_per_step       integer NOT NULL DEFAULT 1 CHECK (xp_purchase_per_step BETWEEN 0 AND 1000),
  purchase_step_idr          integer NOT NULL DEFAULT 10000 CHECK (purchase_step_idr BETWEEN 1000 AND 10000000),
  -- Buying a package while the previous one still runs.
  xp_early_renewal           integer NOT NULL DEFAULT 150 CHECK (xp_early_renewal BETWEEN 0 AND 10000),
  updated_by                 uuid,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
INSERT INTO gym.loyalty_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Off-peak hours per branch, minutes after midnight in the branch zone. A
-- branch without a row has no off-peak bonus.
CREATE TABLE IF NOT EXISTS gym.loyalty_offpeak_hours (
  branch_id  uuid PRIMARY KEY REFERENCES configuration.branches (id) ON DELETE CASCADE,
  starts_min integer NOT NULL CHECK (starts_min BETWEEN 0 AND 1439),
  ends_min   integer NOT NULL CHECK (ends_min BETWEEN 1 AND 1440),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_min > starts_min)
);

-- 5. Member status -----------------------------------------------------------------
-- No row means active. suspended_until is set for suspended only.
CREATE TABLE IF NOT EXISTS gym.member_status (
  customer_id     uuid PRIMARY KEY REFERENCES pos.pos_customers (id) ON DELETE CASCADE,
  status          text NOT NULL CHECK (status IN ('active', 'suspended', 'banned')),
  reason          text,
  suspended_until timestamptz,
  changed_by      uuid,
  changed_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'suspended') = (suspended_until IS NOT NULL)),
  CHECK (status = 'active' OR length(btrim(COALESCE(reason, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS idx_gym_member_status_frozen ON gym.member_status (status) WHERE status <> 'active';

CREATE TABLE IF NOT EXISTS gym.member_status_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE CASCADE,
  from_status     text NOT NULL,
  to_status       text NOT NULL,
  reason          text,
  suspended_until timestamptz,
  changed_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gym_member_status_events_customer
  ON gym.member_status_events (customer_id, created_at DESC);

-- 6. Constraints other contexts own ----------------------------------------------
-- Gym XP posts to the CRM ledger on channel 'gym'.
ALTER TABLE crm.crm_xp_ledger DROP CONSTRAINT IF EXISTS crm_xp_ledger_source_channel_check;
ALTER TABLE crm.crm_xp_ledger ADD CONSTRAINT crm_xp_ledger_source_channel_check CHECK (source_channel = ANY (
  ARRAY['pos', 'photobooth', 'studio_game', 'manual', 'campaign', 'redemption', 'gym']));

-- The gate logs a banned member's scan.
ALTER TABLE gym.access_logs DROP CONSTRAINT IF EXISTS access_logs_reason_check;
ALTER TABLE gym.access_logs ADD CONSTRAINT access_logs_reason_check CHECK (reason IN (
  'token_invalid', 'token_expired', 'token_consumed', 'member_not_active', 'anti_passback', 'no_booking',
  'insufficient_credits', 'waiver_required', 'open_gym_closed', 'member_banned'));

-- Spending reads per member.
CREATE INDEX IF NOT EXISTS idx_pos_orders_customer_paid
  ON pos.pos_orders (customer_id, created_at) WHERE payment_status = 'paid' AND customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shop_orders_customer_paid
  ON shop.orders (customer_id, paid_at) WHERE customer_id IS NOT NULL AND paid_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gym_credit_purchases_customer_paid
  ON gym.credit_purchases (customer_id, paid_at) WHERE paid_at IS NOT NULL;

-- 7. Menu Gym → Membership & Progres -----------------------------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym.loyalty', 'Membership & Progres', '/dashboard/gym/loyalty', 'star', 'sidebar', 92,
        '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 2 WHERE code = 'gym.loyalty';
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code = 'gym.loyalty' AND parent.code = 'gym';

-- Managers edit tiers and set member status; the front desk does not.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('super_admin', 'admin', 'gym_manager')
   AND m.code = 'gym.loyalty'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
