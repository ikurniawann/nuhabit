-- =============================================================================
-- Member referral program. Each member gets a code; a friend who signs up
-- with it and makes a first paid gym purchase earns both sides a reward once
-- the purchase has stayed unrefunded through the hold window. The
-- member-portal module owns these tables and settles them from its
-- "member-portal.referral-rewards" job. Idempotent.
-- =============================================================================

-- 1. Program settings: one row, edited from Gym → Referral --------------------
CREATE TABLE IF NOT EXISTS crm.referral_settings (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  is_active            boolean NOT NULL DEFAULT false,
  -- Bonus class credits for the member who shared the code.
  referrer_credits     integer NOT NULL DEFAULT 0 CHECK (referrer_credits BETWEEN 0 AND 100),
  -- ARK Coin (rupiah) for the member who shared the code.
  referrer_ark_idr     numeric(14,2) NOT NULL DEFAULT 0 CHECK (referrer_ark_idr BETWEEN 0 AND 10000000),
  -- Bonus class credits for the new member.
  referee_credits      integer NOT NULL DEFAULT 0 CHECK (referee_credits BETWEEN 0 AND 100),
  -- Promo campaign whose single-use code the new member gets at sign-up
  -- (discount on the first package through the promo engine).
  referee_campaign_id  uuid REFERENCES promo.promo_campaigns(id) ON DELETE SET NULL,
  -- Expiry of the bonus credit lots, in days from the release.
  credit_validity_days integer NOT NULL DEFAULT 30 CHECK (credit_validity_days BETWEEN 1 AND 365),
  -- Days a first purchase must stay unrefunded before rewards are released.
  hold_days            integer NOT NULL DEFAULT 7 CHECK (hold_days BETWEEN 0 AND 90),
  -- Referrer rewards per calendar month (WIB); 0 = no cap.
  monthly_cap          integer NOT NULL DEFAULT 10 CHECK (monthly_cap BETWEEN 0 AND 1000),
  updated_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
INSERT INTO crm.referral_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 2. One code per member, created the first time the member opens the screen --
CREATE TABLE IF NOT EXISTS crm.referral_codes (
  customer_id uuid PRIMARY KEY REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  code        varchar(16) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_codes_code_uniq UNIQUE (code)
);

-- 3. Devices (sha256 of the app's device id) seen per member, for the
--    same-device guard.
CREATE TABLE IF NOT EXISTS crm.referral_devices (
  device_hash   text NOT NULL,
  customer_id   uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_hash, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_referral_devices_customer ON crm.referral_devices (customer_id);

-- 4. Referrals: joined -> held -> rewarded | capped | void; blocked at sign-up.
CREATE TABLE IF NOT EXISTS crm.referrals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id          uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  referee_id           uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  code                 varchar(16) NOT NULL,
  status               text NOT NULL DEFAULT 'joined'
                       CHECK (status IN ('joined', 'held', 'rewarded', 'capped', 'void', 'blocked')),
  -- Why it was blocked or voided (self_referral, same_contact, same_device, refunded).
  reason               text,
  device_hash          text,
  purchase_id          uuid REFERENCES gym.credit_purchases(id) ON DELETE SET NULL,
  qualified_at         timestamptz,
  hold_until           timestamptz,
  settled_at           timestamptz,
  referrer_credits     integer NOT NULL DEFAULT 0,
  referrer_ark_idr     numeric(14,2) NOT NULL DEFAULT 0,
  referee_credits      integer NOT NULL DEFAULT 0,
  referee_voucher_code varchar(40),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referrals_referee_uniq UNIQUE (referee_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON crm.referrals (referrer_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_open ON crm.referrals (status, hold_until)
  WHERE status IN ('joined', 'held');
CREATE INDEX IF NOT EXISTS idx_referrals_settled ON crm.referrals (settled_at)
  WHERE status IN ('rewarded', 'capped');
CREATE INDEX IF NOT EXISTS idx_referrals_device ON crm.referrals (device_hash)
  WHERE device_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_purchase ON crm.referrals (purchase_id);

-- 5. Menu Gym → Referral --------------------------------------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym.referrals', 'Referral', '/dashboard/gym/referrals', 'user-plus', 'sidebar', 90, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 2 WHERE code = 'gym.referrals';
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code = 'gym.referrals' AND parent.code = 'gym';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('super_admin', 'admin', 'marketing')
   AND m.code = 'gym.referrals'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
