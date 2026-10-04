-- EPIC-011 Fase A: fondasi CRM Revamp — keputusan owner 2026-07-19.
-- Member global lintas tenant; XP lifetime append-only; 2 tipe member
-- (registered/card); venue dicatat di wallet/XP/order untuk rekonsiliasi.
-- CATATAN: kolom current_xp/spent_xp BELUM di-drop di fase ini — engine lama
-- masih membacanya; drop dilakukan di Fase B bersamaan rewrite engine XP.

-- ============================================================
-- 1. pos_customers: tipe member + profil lengkap + consent
-- ============================================================
ALTER TABLE pos.pos_customers
  ADD COLUMN IF NOT EXISTS member_type varchar(20) NOT NULL DEFAULT 'registered',
  ADD COLUMN IF NOT EXISTS card_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS gender varchar(10),
  ADD COLUMN IF NOT EXISTS city varchar(100),
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS wa_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wa_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS free_xp_granted_at timestamptz;

DO $$ BEGIN
  ALTER TABLE pos.pos_customers
    ADD CONSTRAINT pos_customers_member_type_check
    CHECK (member_type IN ('registered', 'card'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE pos.pos_customers
    ADD CONSTRAINT pos_customers_gender_check
    CHECK (gender IS NULL OR gender IN ('male', 'female'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Pelanggan yang sudah punya kartu NFC = member kartu
UPDATE pos.pos_customers
SET member_type = 'card',
    card_issued_at = COALESCE(card_issued_at, updated_at, now())
WHERE nfc_uid IS NOT NULL AND member_type = 'registered';

-- ============================================================
-- 2. Tier Regular (tier awal, 0 XP) + default tier member baru
-- ============================================================
-- Regular menempati rank 0 → longgarkan check rank dari (>0) ke (>=0)
ALTER TABLE crm.crm_membership_tiers
  DROP CONSTRAINT IF EXISTS crm_membership_tiers_rank_positive;
DO $$ BEGIN
  ALTER TABLE crm.crm_membership_tiers
    ADD CONSTRAINT crm_membership_tiers_rank_nonnegative CHECK (rank >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO crm.crm_membership_tiers
  (code, name, rank, min_lifetime_xp, min_total_spend, xp_multiplier,
   discount_percent, display_color)
VALUES ('regular', 'Regular', 0, 0, 0, 1, 0, '#6B7280')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE pos.pos_customers
  ALTER COLUMN membership_tier SET DEFAULT 'regular';

-- ============================================================
-- 3. Kolom venue (rekonsiliasi antar-venue) di wallet / XP / order
-- ============================================================
ALTER TABLE pos.pos_wallet_transactions
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES configuration.companies(id),
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES configuration.branches(id);

ALTER TABLE crm.crm_xp_ledger
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES configuration.companies(id),
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES configuration.branches(id);

ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES configuration.companies(id),
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES configuration.branches(id);

CREATE INDEX IF NOT EXISTS idx_pos_wallet_branch
  ON pos.pos_wallet_transactions (branch_id);
CREATE INDEX IF NOT EXISTS idx_crm_xp_ledger_branch
  ON crm.crm_xp_ledger (branch_id);
CREATE INDEX IF NOT EXISTS idx_pos_orders_branch
  ON pos.pos_orders (branch_id);

-- ============================================================
-- 4. Konfigurasi CRM (Super Admin) — key-value
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_settings (
  key varchar(60) PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO crm.crm_settings (key, value, description) VALUES
  ('topup_bonus_percent', '10',
   'Bonus topup ARK Coin (%) — topup 1jt dapat saldo 1,1jt'),
  ('profile_completion_free_xp', '100',
   'Free XP saat profil member 100% komplit (sekali seumur hidup)'),
  ('default_company_id', 'null',
   'Venue default (company) untuk stempel transaksi selama single-venue'),
  ('default_branch_id', 'null',
   'Venue default (branch) untuk stempel transaksi selama single-venue')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 5. RPC topup atomik — lock saldo, TIDAK menambah total_spent
--    (top spender = nilai belanja, bukan setoran topup)
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_ark_topup(
  p_customer_id uuid,
  p_amount numeric,
  p_payment_method text DEFAULT 'qris',
  p_xendit_transaction_id text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance_before numeric(12,2);
  v_balance_after numeric(12,2);
  v_tx_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Topup amount must be positive';
  END IF;

  SELECT ark_coin_balance INTO v_balance_before
  FROM pos.pos_customers
  WHERE id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id;
  END IF;

  v_balance_before := COALESCE(v_balance_before, 0);
  v_balance_after := v_balance_before + p_amount;

  UPDATE pos.pos_customers
  SET ark_coin_balance = v_balance_after,
      updated_at = now()
  WHERE id = p_customer_id;

  INSERT INTO pos.pos_wallet_transactions (
    customer_id, type, amount, ark_coins, balance_before, balance_after,
    payment_method, xendit_transaction_id, notes, company_id, branch_id
  ) VALUES (
    p_customer_id, 'topup', p_amount, p_amount / 1000,
    v_balance_before, v_balance_after,
    p_payment_method::public.pos_payment_method, p_xendit_transaction_id,
    'Topup via ' || upper(p_payment_method), p_company_id, p_branch_id
  ) RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after,
    'ark_coins', p_amount / 1000
  );
END;
$$;

-- Isi venue default dari hierarchy yang ada (single-venue: Sulu Bandung)
UPDATE crm.crm_settings s
SET value = to_jsonb(c.id::text)
FROM configuration.companies c
WHERE s.key = 'default_company_id' AND s.value = 'null'::jsonb
  AND c.id = (SELECT id FROM configuration.companies ORDER BY created_at LIMIT 1);

UPDATE crm.crm_settings s
SET value = to_jsonb(b.id::text)
FROM configuration.branches b
WHERE s.key = 'default_branch_id' AND s.value = 'null'::jsonb
  AND b.id = (SELECT id FROM configuration.branches ORDER BY created_at LIMIT 1);
