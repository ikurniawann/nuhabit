-- EPIC-014 Task 2: mesin jatah tukar collectibles + penuntasan blocker XP kanonik.

-- 1) KEPUTUSAN KANONIK (25 Jul 2026): pos.pos_customers.total_xp adalah satu-
--    satunya sumber XP member (konsisten EPIC-011). crm_member_profiles.
--    lifetime_xp = mirror internal engine; di-backfill agar tidak menyimpang
--    (kasus dev: member uji ber-seed manual 700 vs 500, ledger 0).
UPDATE crm.crm_member_profiles p
   SET lifetime_xp = c.total_xp, loyalty_score = c.total_xp
  FROM pos.pos_customers c
 WHERE c.id = p.customer_id
   AND p.lifetime_xp IS DISTINCT FROM c.total_xp;

COMMENT ON COLUMN crm.crm_member_profiles.lifetime_xp IS
  'MIRROR dari pos.pos_customers.total_xp (kanonik). Jangan dibaca untuk logika baru.';

-- 2) Ambang kelayakan per artwork (syarat, BUKAN harga — jatah yang dipakai).
ALTER TABLE crm.crm_collectible_avatars
  ADD COLUMN IF NOT EXISTS min_lifetime_xp integer;

-- 3) Ledger penukaran jatah. Sisa jatah = floor(total_xp/interval) - count(*).
CREATE TABLE IF NOT EXISTS crm.crm_member_entitlements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  member_id    uuid REFERENCES crm.crm_member_profiles(id) ON DELETE SET NULL,
  asset_type   text NOT NULL CHECK (asset_type IN ('avatar', 'wallpaper')),
  asset_id     uuid NOT NULL,
  redeemed_at  timestamptz NOT NULL DEFAULT now(),
  -- Satu member satu salinan per artwork.
  UNIQUE (customer_id, asset_type, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_member_entitlements_customer
  ON crm.crm_member_entitlements (customer_id, redeemed_at DESC);

-- 4) Interval jatah konfigurable Super Admin (crm_settings key-value).
INSERT INTO crm.crm_settings (key, value)
VALUES ('collectible_interval_xp', '5000')
ON CONFLICT (key) DO NOTHING;
