-- EPIC-011 Fase F: Reward redeem berbasis SYARAT XP (bukan biaya XP).
--
-- Koreksi semantik dari skema lama: `xp_cost` mengasumsikan XP dipotong saat
-- redeem. Keputusan owner (Fase B) menetapkan XP = skor seumur hidup yang
-- TIDAK PERNAH berkurang. Jadi kolom itu berubah makna menjadi `min_xp`:
-- ambang minimum lifetime XP yang harus dicapai member agar BERHAK redeem.
-- Redeem tidak mengubah total_xp sama sekali.
--
-- Admin mengelola: reward mana yang bisa di-redeem (is_active + periode),
-- syarat kelayakan (min_xp / tier), stok global, dan kuota per member
-- (max_redemptions_per_member + quota_period).

-- 1) crm_rewards: xp_cost -> min_xp -------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'crm' AND table_name = 'crm_rewards' AND column_name = 'xp_cost'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'crm' AND table_name = 'crm_rewards' AND column_name = 'min_xp'
  ) THEN
    ALTER TABLE crm.crm_rewards RENAME COLUMN xp_cost TO min_xp;
  END IF;
END $$;

ALTER TABLE crm.crm_rewards DROP CONSTRAINT IF EXISTS crm_rewards_xp_cost_positive;
ALTER TABLE crm.crm_rewards DROP CONSTRAINT IF EXISTS crm_rewards_min_xp_positive;
ALTER TABLE crm.crm_rewards
  ADD CONSTRAINT crm_rewards_min_xp_positive CHECK (min_xp >= 0);

-- 2) Kuota redeem per member: berapa kali + periode reset ---------------------
ALTER TABLE crm.crm_rewards
  ADD COLUMN IF NOT EXISTS quota_period text NOT NULL DEFAULT 'total';

ALTER TABLE crm.crm_rewards DROP CONSTRAINT IF EXISTS crm_rewards_quota_period_check;
ALTER TABLE crm.crm_rewards
  ADD CONSTRAINT crm_rewards_quota_period_check
  CHECK (quota_period = ANY (ARRAY['total'::text, 'daily'::text, 'monthly'::text, 'yearly'::text]));

COMMENT ON COLUMN crm.crm_rewards.min_xp IS
  'Ambang minimum lifetime XP agar member berhak redeem. TIDAK dipotong saat redeem (EPIC-011 Fase F).';
COMMENT ON COLUMN crm.crm_rewards.max_redemptions_per_member IS
  'Kuota redeem per member dalam satu quota_period. NULL = tanpa batas.';
COMMENT ON COLUMN crm.crm_rewards.quota_period IS
  'Jendela reset kuota: total (seumur hidup) | daily | monthly | yearly.';

-- 3) crm_redemptions: simpan snapshot syarat, bukan biaya ---------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'crm' AND table_name = 'crm_redemptions' AND column_name = 'xp_cost'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'crm' AND table_name = 'crm_redemptions' AND column_name = 'min_xp_at_redeem'
  ) THEN
    ALTER TABLE crm.crm_redemptions RENAME COLUMN xp_cost TO min_xp_at_redeem;
  END IF;
END $$;

ALTER TABLE crm.crm_redemptions DROP CONSTRAINT IF EXISTS crm_redemptions_xp_cost_positive;
ALTER TABLE crm.crm_redemptions DROP CONSTRAINT IF EXISTS crm_redemptions_min_xp_positive;
ALTER TABLE crm.crm_redemptions
  ADD CONSTRAINT crm_redemptions_min_xp_positive CHECK (min_xp_at_redeem >= 0);

-- xp_ledger_id tidak lagi dipakai: redeem tidak menulis ledger XP.
COMMENT ON COLUMN crm.crm_redemptions.min_xp_at_redeem IS
  'Snapshot syarat min_xp reward saat diajukan (audit). Bukan biaya — XP tidak dipotong.';

-- Jejak asal & pelaksana redeem (portal member vs kasir/admin di venue).
ALTER TABLE crm.crm_redemptions
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'admin';
ALTER TABLE crm.crm_redemptions
  ADD COLUMN IF NOT EXISTS total_xp_at_redeem integer;
ALTER TABLE crm.crm_redemptions
  ADD COLUMN IF NOT EXISTS requested_by_user_id uuid;
ALTER TABLE crm.crm_redemptions
  ADD COLUMN IF NOT EXISTS processed_by_user_id uuid;

ALTER TABLE crm.crm_redemptions DROP CONSTRAINT IF EXISTS crm_redemptions_channel_check;
ALTER TABLE crm.crm_redemptions
  ADD CONSTRAINT crm_redemptions_channel_check
  CHECK (channel = ANY (ARRAY['portal'::text, 'admin'::text]));

COMMENT ON COLUMN crm.crm_redemptions.channel IS
  'portal = diajukan member sendiri (perlu approve); admin = diklaim kasir/admin di venue (langsung fulfilled).';

-- Sejak Fase B sumber kebenaran member/XP adalah pos.pos_customers, sedangkan
-- crm_member_profiles hanya ada untuk sebagian member. Redemption karena itu
-- dikunci ke customer_id; member_id tetap diisi bila profilnya ada.
ALTER TABLE crm.crm_redemptions ALTER COLUMN member_id DROP NOT NULL;

-- Backfill customer_id dari profil member untuk baris redemption lama.
UPDATE crm.crm_redemptions r
   SET customer_id = p.customer_id
  FROM crm.crm_member_profiles p
 WHERE r.member_id = p.id
   AND r.customer_id IS NULL
   AND p.customer_id IS NOT NULL;

-- Hanya kunci NOT NULL bila tidak ada sisa baris yatim (dev bisa punya data lama).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM crm.crm_redemptions WHERE customer_id IS NULL) THEN
    ALTER TABLE crm.crm_redemptions ALTER COLUMN customer_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'crm_redemptions: ada baris dengan customer_id NULL — NOT NULL dilewati.';
  END IF;
END $$;

-- Hitung kuota per member per reward per periode.
CREATE INDEX IF NOT EXISTS crm_redemptions_quota_idx
  ON crm.crm_redemptions (customer_id, reward_id, requested_at DESC);
