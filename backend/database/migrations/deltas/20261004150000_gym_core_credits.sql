-- =============================================================================
-- Gym core: kredit kelas + aturan bisnis gym (port NüHabit catalog/wallet).
--
--   1. Schema gym + gym.business_rules (baris global branch_id NULL + override cabang).
--   2. gym.credit_packages (paket kredit; diarsipkan, tidak dihapus bila sudah terjual).
--   3. gym.credit_purchases (uang: pending → paid → refunded, terpisah dari kredit).
--   4. gym.credit_lots (satu batch kredit + tanggal kedaluwarsa, konsumsi FIFO).
--   5. gym.credit_ledger (append-only; saldo = SUM(amount), tidak disimpan di mana pun).
--   6. Seed paket demo (idempotent).
--   7. Menu IAM grup "Gym & Kelas" + Paket Kredit, Kredit Member, Aturan Gym.
--
-- Idempotent: aman dijalankan ulang.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS gym;

-- 1. Aturan bisnis -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS gym.business_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = aturan global; baris cabang hanya berisi kunci yang di-override.
  branch_id   uuid UNIQUE REFERENCES configuration.branches (id) ON DELETE CASCADE,
  rules       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE(branch_id) tidak mencegah dua baris NULL: indeks ini menjaga satu baris global.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_business_rules_global
  ON gym.business_rules ((branch_id IS NULL)) WHERE branch_id IS NULL;

INSERT INTO gym.business_rules (branch_id, rules)
SELECT NULL, '{
  "creditExpiryDays": 60,
  "cancellationDeadlineHours": 4,
  "lateCancelPolicy": "forfeit",
  "noShowPolicy": "forfeit",
  "reEntryGraceMin": 15,
  "antiPassbackMin": 60,
  "qrTtlSec": 45,
  "waitlistAutoPromote": true,
  "lowBalanceThreshold": 3,
  "expiryReminderDays": 7,
  "bookingOpensDaysBefore": 7,
  "bookingClosesMinBefore": 0
}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM gym.business_rules WHERE branch_id IS NULL);

-- 2. Paket kredit ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gym.credit_packages (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       text NOT NULL,
  description                text NOT NULL DEFAULT '',
  credits                    integer NOT NULL CHECK (credits > 0),
  price_idr                  numeric(14,2) NOT NULL CHECK (price_idr >= 0),
  validity_days              integer NOT NULL CHECK (validity_days > 0),
  purchase_limit_per_member  integer CHECK (purchase_limit_per_member > 0),
  -- NULL = kredit berlaku untuk semua jenis kelas.
  applicable_class_type_ids  uuid[],
  -- NULL = dijual di semua cabang.
  branch_id                  uuid REFERENCES configuration.branches (id) ON DELETE SET NULL,
  status                     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  sort_order                 integer NOT NULL DEFAULT 0,
  created_by                 uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gym_credit_packages_status ON gym.credit_packages (status, sort_order);

-- 3. Pembelian paket (uang) --------------------------------------------------

CREATE TABLE IF NOT EXISTS gym.credit_purchases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE RESTRICT,
  package_id      uuid NOT NULL REFERENCES gym.credit_packages (id) ON DELETE RESTRICT,
  credits         integer NOT NULL CHECK (credits > 0),
  price_idr       numeric(14,2) NOT NULL CHECK (price_idr >= 0),
  discount_idr    numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_idr >= 0),
  total_idr       numeric(14,2) NOT NULL CHECK (total_idr >= 0),
  -- member_portal | front_desk
  channel         text NOT NULL,
  -- qris | ark_coin | cash | card | transfer | complimentary
  payment_method  text,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'refunded')),
  -- reference_id QRIS Xendit (prefix gymcp_) agar webhook bisa mencocokkan.
  external_id     text,
  payment_meta    jsonb NOT NULL DEFAULT '{}'::jsonb,
  branch_id       uuid REFERENCES configuration.branches (id) ON DELETE SET NULL,
  note            text,
  paid_at         timestamptz,
  refunded_at     timestamptz,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_credit_purchases_total_consistent CHECK (total_idr = price_idr - discount_idr)
);

CREATE INDEX IF NOT EXISTS idx_gym_credit_purchases_customer ON gym.credit_purchases (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_credit_purchases_package ON gym.credit_purchases (package_id, status);
CREATE INDEX IF NOT EXISTS idx_gym_credit_purchases_status ON gym.credit_purchases (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_credit_purchases_external
  ON gym.credit_purchases (external_id) WHERE external_id IS NOT NULL;

-- 4. Lot kredit --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gym.credit_lots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE RESTRICT,
  -- NULL untuk kredit bonus / penyesuaian.
  package_id   uuid REFERENCES gym.credit_packages (id) ON DELETE RESTRICT,
  purchase_id  uuid REFERENCES gym.credit_purchases (id) ON DELETE RESTRICT,
  credits      integer NOT NULL CHECK (credits > 0),
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gym_credit_lots_customer ON gym.credit_lots (customer_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_gym_credit_lots_expiry ON gym.credit_lots (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_credit_lots_purchase
  ON gym.credit_lots (purchase_id) WHERE purchase_id IS NOT NULL;

-- 5. Buku besar kredit -------------------------------------------------------

CREATE TABLE IF NOT EXISTS gym.credit_ledger (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        uuid NOT NULL REFERENCES pos.pos_customers (id) ON DELETE RESTRICT,
  type               text NOT NULL CHECK (type IN
                       ('top_up', 'class_deduction', 'refund', 'bonus', 'expiration', 'adjustment', 'reversal')),
  -- Kredit bertanda: positif menambah, negatif memakai.
  amount             integer NOT NULL CHECK (amount <> 0),
  -- Lot yang dibuat (top_up/bonus/adjustment plus) atau dikurangi langsung (expiration/reversal lot).
  lot_id             uuid REFERENCES gym.credit_lots (id) ON DELETE RESTRICT,
  -- purchase | booking | admin | system | ...
  source_type        text,
  source_id          uuid,
  reverses_entry_id  uuid REFERENCES gym.credit_ledger (id) ON DELETE RESTRICT,
  note               text,
  idempotency_key    text UNIQUE,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gym_credit_ledger_customer ON gym.credit_ledger (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_credit_ledger_source ON gym.credit_ledger (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_gym_credit_ledger_lot ON gym.credit_ledger (lot_id) WHERE lot_id IS NOT NULL;
-- Satu entri hanya boleh dibatalkan sekali.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_credit_ledger_reversal
  ON gym.credit_ledger (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;

COMMENT ON TABLE gym.credit_ledger IS
  'Buku besar kredit kelas, append-only. Saldo member = SUM(amount). Koreksi lewat entri reversal, bukan UPDATE/DELETE.';

CREATE OR REPLACE FUNCTION gym.fn_credit_ledger_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'gym.credit_ledger bersifat append-only (% ditolak)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_gym_credit_ledger_append_only ON gym.credit_ledger;
CREATE TRIGGER trg_gym_credit_ledger_append_only
  BEFORE UPDATE OR DELETE ON gym.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION gym.fn_credit_ledger_append_only();

-- 6. Seed paket demo ---------------------------------------------------------

INSERT INTO gym.credit_packages (name, description, credits, price_idr, validity_days, purchase_limit_per_member, sort_order)
SELECT v.name, v.description, v.credits, v.price_idr, v.validity_days, v.limit_per, v.sort_order
FROM (VALUES
  ('Trial Class', 'Satu kelas percobaan untuk member baru.', 1, 200000::numeric, 14, 1, 10),
  ('Starter 5', 'Lima kredit untuk mulai rutin latihan.', 5, 800000::numeric, 60, NULL::int, 20),
  ('10 Visit Pack', 'Sepuluh kredit, berlaku 90 hari.', 10, 1500000::numeric, 90, NULL::int, 30),
  ('20 Visit Pack', 'Dua puluh kredit, harga per kelas paling hemat.', 20, 2700000::numeric, 120, NULL::int, 40),
  ('Race Prep Block', 'Delapan kredit untuk blok persiapan race HYROX.', 8, 1400000::numeric, 60, NULL::int, 50)
) AS v(name, description, credits, price_idr, validity_days, limit_per, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM gym.credit_packages p WHERE p.name = v.name);

-- 7. Menu IAM ----------------------------------------------------------------

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('gym', 'Gym & Kelas', NULL, 'calendar', 'group', 3, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('gym.packages', 'Paket Kredit', '/dashboard/gym/packages', 'package', 'sidebar', 70, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('gym.credits', 'Kredit Member', '/dashboard/gym/credits', 'banknotes', 'sidebar', 80, '{"actions":["read","create","update"]}'::jsonb),
  ('gym.rules', 'Aturan Gym', '/dashboard/gym/rules', 'settings', 'sidebar', 100, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'gym', level = 1 WHERE code = 'gym';
UPDATE iam.menus SET module = 'gym', level = 2 WHERE code IN ('gym.packages', 'gym.credits', 'gym.rules');
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code IN ('gym.packages', 'gym.credits', 'gym.rules') AND parent.code = 'gym';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'marketing')
  AND m.code IN ('gym', 'gym.packages', 'gym.credits', 'gym.rules')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
