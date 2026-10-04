-- =============================================================================
-- Workstream D: batasan kode promo, penawaran otomatis lanjutan, gift card
-- reload/link member, bonus XP per produk. Idempoten.
-- =============================================================================

-- 1) Kode promo: batas produk/kategori + kelayakan member ---------------------
-- Target kosong = berlaku untuk semua item. Diskon dihitung hanya dari baris
-- yang cocok (produk ATAU kategori).
-- eligibility: semua | member (wajib pilih member) | member_baru (member yang
-- belum pernah punya order lunas; new_member_days opsional = sekaligus
-- terdaftar <= N hari).
ALTER TABLE promo.promo_campaigns
  ADD COLUMN IF NOT EXISTS target_product_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_category_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS eligibility varchar(15) NOT NULL DEFAULT 'semua',
  ADD COLUMN IF NOT EXISTS new_member_days integer;

ALTER TABLE promo.promo_campaigns
  DROP CONSTRAINT IF EXISTS promo_campaigns_eligibility_check;
ALTER TABLE promo.promo_campaigns
  ADD CONSTRAINT promo_campaigns_eligibility_check
  CHECK (eligibility IN ('semua', 'member', 'member_baru'));

ALTER TABLE promo.promo_campaigns
  DROP CONSTRAINT IF EXISTS promo_campaigns_new_member_days_check;
ALTER TABLE promo.promo_campaigns
  ADD CONSTRAINT promo_campaigns_new_member_days_check
  CHECK (new_member_days IS NULL OR new_member_days BETWEEN 1 AND 3650);

-- 2) Penawaran otomatis: channel, kuota, eksklusif/prioritas, kode buka --------
ALTER TABLE promo.offer_rules
  ADD COLUMN IF NOT EXISTS sales_channels text[],
  ADD COLUMN IF NOT EXISTS max_uses integer,
  ADD COLUMN IF NOT EXISTS max_uses_per_member integer,
  ADD COLUMN IF NOT EXISTS is_exclusive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unlock_code varchar(40);

ALTER TABLE promo.offer_rules
  DROP CONSTRAINT IF EXISTS offer_rules_caps_check;
ALTER TABLE promo.offer_rules
  ADD CONSTRAINT offer_rules_caps_check CHECK (
    (max_uses IS NULL OR max_uses > 0)
    AND (max_uses_per_member IS NULL OR max_uses_per_member > 0)
  );

-- Kode pembuka penawaran unik per venue (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS offer_rules_unlock_code_uniq
  ON promo.offer_rules (branch_id, upper(unlock_code))
  WHERE unlock_code IS NOT NULL;

-- Target kategori di samping produk: tiap baris tepat satu dari keduanya
ALTER TABLE promo.offer_rule_items
  ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE promo.offer_rule_items
  ADD COLUMN IF NOT EXISTS category_id uuid;
ALTER TABLE promo.offer_rule_items
  DROP CONSTRAINT IF EXISTS offer_rule_items_target_check;
ALTER TABLE promo.offer_rule_items
  ADD CONSTRAINT offer_rule_items_target_check
  CHECK (num_nonnulls(product_id, category_id) = 1);

-- Pemakaian penawaran per order (kuota total & per member).
-- held = diklaim saat order dibuat (dihitung 30 menit; tak tertangkap =
-- kadaluarsa sendiri), captured = order lunas/open bill tercatat,
-- released = order di-void.
CREATE TABLE IF NOT EXISTS promo.offer_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  branch_id uuid,
  rule_id uuid NOT NULL REFERENCES promo.offer_rules(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  customer_id uuid,
  discount_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  status varchar(10) NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'captured', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_usages_rule_order_uniq UNIQUE (rule_id, order_id)
);

CREATE INDEX IF NOT EXISTS offer_usages_rule_status_idx
  ON promo.offer_usages (rule_id, status);
CREATE INDEX IF NOT EXISTS offer_usages_rule_customer_idx
  ON promo.offer_usages (rule_id, customer_id)
  WHERE status <> 'released';
CREATE INDEX IF NOT EXISTS offer_usages_order_idx
  ON promo.offer_usages (order_id);

-- 3) Gift card: tautan member + reload ---------------------------------------
ALTER TABLE giftcard.gift_cards
  ADD COLUMN IF NOT EXISTS customer_id uuid
    REFERENCES pos.pos_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reloaded_total numeric(14, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_gift_cards_customer
  ON giftcard.gift_cards (customer_id)
  WHERE customer_id IS NOT NULL;

-- Saldo boleh melewati nilai terbit sebesar total reload
ALTER TABLE giftcard.gift_cards
  DROP CONSTRAINT IF EXISTS gift_cards_balance_le_initial;
ALTER TABLE giftcard.gift_cards
  DROP CONSTRAINT IF EXISTS gift_cards_balance_le_loaded;
ALTER TABLE giftcard.gift_cards
  ADD CONSTRAINT gift_cards_balance_le_loaded
  CHECK (reloaded_total >= 0 AND balance <= initial_value + reloaded_total);

-- Ledger reload mencatat pembayaran
ALTER TABLE giftcard.gift_card_ledger
  ADD COLUMN IF NOT EXISTS payment_method varchar(30),
  ADD COLUMN IF NOT EXISTS payment_reference varchar(80);

ALTER TABLE giftcard.gift_card_ledger
  DROP CONSTRAINT IF EXISTS gift_card_ledger_context_type_check;
ALTER TABLE giftcard.gift_card_ledger
  ADD CONSTRAINT gift_card_ledger_context_type_check
  CHECK (context_type IN ('pos_order', 'ticket_booking', 'manual', 'reload'));

-- 4) Bonus XP per produk ------------------------------------------------------
ALTER TABLE pos.pos_products
  ADD COLUMN IF NOT EXISTS bonus_xp integer NOT NULL DEFAULT 0;
ALTER TABLE pos.pos_products
  DROP CONSTRAINT IF EXISTS pos_products_bonus_xp_check;
ALTER TABLE pos.pos_products
  ADD CONSTRAINT pos_products_bonus_xp_check CHECK (bonus_xp BETWEEN 0 AND 100000);

COMMENT ON COLUMN pos.pos_products.bonus_xp IS
  'XP tambahan per unit saat order member lunas (sekali per order, tanpa multiplier tier).';
