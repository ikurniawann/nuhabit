-- =============================================================================
-- Gym credit transfers and package-targeted vouchers
-- =============================================================================
--   1. gym.credit_ledger accepts transfer_in and transfer_out entries.
--   2. gym.credit_lots.source_lot_id links a lot received by transfer to the
--      sender's lot it came from: same package (class types) and expiry, and
--      the journals value its credits at that lot's purchase price.
--   3. gym.credit_transfers records each transfer (who, how many, by staff or
--      by the member) and gym.credit_transfer_lots the lots it moved. The
--      idempotency key makes a retried request a no-op. No money moves, so no
--      journal is posted.
--   4. promo.promo_campaigns.target_gym_package_ids limits a campaign to some
--      gym packages; empty means every package.
-- Idempotent.
-- =============================================================================

ALTER TABLE gym.credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_type_check;
ALTER TABLE gym.credit_ledger ADD CONSTRAINT credit_ledger_type_check CHECK (type IN
  ('top_up', 'class_deduction', 'refund', 'bonus', 'expiration', 'adjustment', 'reversal', 'transfer_in', 'transfer_out'));

ALTER TABLE gym.credit_lots
  ADD COLUMN IF NOT EXISTS source_lot_id uuid REFERENCES gym.credit_lots (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_gym_credit_lots_source ON gym.credit_lots (source_lot_id);

COMMENT ON COLUMN gym.credit_lots.source_lot_id IS
  'Lot pengirim untuk lot hasil transfer kredit: paket dan kedaluwarsa sama, nilai per kredit ikut lot asal.';

CREATE TABLE IF NOT EXISTS gym.credit_transfers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_customer_id  uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE RESTRICT,
  to_customer_id    uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE RESTRICT,
  credits           integer NOT NULL CHECK (credits > 0),
  -- staff: dari halaman kredit; member: dari aplikasi member.
  channel           text NOT NULL CHECK (channel IN ('staff', 'member')),
  note              text,
  idempotency_key   text NOT NULL UNIQUE,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_transfers_distinct_members CHECK (from_customer_id <> to_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_gym_credit_transfers_from ON gym.credit_transfers (from_customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_credit_transfers_to ON gym.credit_transfers (to_customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gym.credit_transfer_lots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id    uuid NOT NULL REFERENCES gym.credit_transfers (id) ON DELETE RESTRICT,
  source_lot_id  uuid NOT NULL REFERENCES gym.credit_lots (id) ON DELETE RESTRICT,
  target_lot_id  uuid NOT NULL REFERENCES gym.credit_lots (id) ON DELETE RESTRICT,
  credits        integer NOT NULL CHECK (credits > 0)
);

CREATE INDEX IF NOT EXISTS idx_gym_credit_transfer_lots_transfer ON gym.credit_transfer_lots (transfer_id);
CREATE INDEX IF NOT EXISTS idx_gym_credit_transfer_lots_source ON gym.credit_transfer_lots (source_lot_id);
CREATE INDEX IF NOT EXISTS idx_gym_credit_transfer_lots_target ON gym.credit_transfer_lots (target_lot_id);

COMMENT ON TABLE gym.credit_transfers IS
  'Transfer kredit kelas antar member. Entri ledger transfer_out/transfer_in memakai source_id = id transfer. Tidak ada jurnal uang.';

ALTER TABLE promo.promo_campaigns
  ADD COLUMN IF NOT EXISTS target_gym_package_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN promo.promo_campaigns.target_gym_package_ids IS
  'Paket gym yang boleh memakai campaign ini; kosong = semua paket.';
