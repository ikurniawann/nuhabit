-- Workstream B: dompet member (ARK Coin) — paket top-up, kedaluwarsa saldo
-- per lot, pengingat, ambang saldo rendah, koreksi admin, top-up mandiri member.
-- Idempoten: aman dijalankan ulang.

-- 1. Paket top-up ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos.pos_topup_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_idr numeric(14,2) NOT NULL CHECK (price_idr > 0),
  -- Saldo yang diterima member; selisih di atas harga = bonus.
  credit_idr numeric(14,2) NOT NULL CHECK (credit_idr >= price_idr),
  -- NULL = saldo paket tidak kedaluwarsa.
  validity_days integer CHECK (validity_days IS NULL OR validity_days > 0),
  is_active boolean NOT NULL DEFAULT true,
  -- Tampil di portal member (top-up mandiri via QRIS).
  available_online boolean NOT NULL DEFAULT true,
  -- Cabang yang boleh menjual paket di kasir; NULL/kosong = semua cabang.
  branch_ids uuid[],
  sort integer NOT NULL DEFAULT 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_topup_packages_active ON pos.pos_topup_packages (is_active, sort);

-- 2. Kolom lot di baris dompet ---------------------------------------------
ALTER TABLE pos.pos_wallet_transactions ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE pos.pos_wallet_transactions ADD COLUMN IF NOT EXISTS expiry_processed_at timestamptz;
ALTER TABLE pos.pos_wallet_transactions
  ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES pos.pos_topup_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_wallet_expiry_due
  ON pos.pos_wallet_transactions (expires_at)
  WHERE expires_at IS NOT NULL AND expiry_processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_wallet_customer_created
  ON pos.pos_wallet_transactions (customer_id, created_at);

-- Penjaga idempotensi: satu baris kedaluwarsa per lot, satu pembatalan per
-- entri, satu refund per top-up.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_wallet_expiration_lot
  ON pos.pos_wallet_transactions ((metadata->>'lot_id'))
  WHERE type = 'expiration';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_wallet_reversal_target
  ON pos.pos_wallet_transactions ((metadata->>'reverses_id'))
  WHERE type = 'reversal';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_wallet_topup_refund_target
  ON pos.pos_wallet_transactions ((metadata->>'refunds_topup_id'))
  WHERE type = 'topup_refund';

-- 3. Pengaturan dompet (satu baris aktif pos_loyalty_settings) ---------------
ALTER TABLE pos.pos_loyalty_settings
  ADD COLUMN IF NOT EXISTS low_balance_threshold_idr numeric NOT NULL DEFAULT 0;
ALTER TABLE pos.pos_loyalty_settings
  ADD COLUMN IF NOT EXISTS wallet_default_validity_days integer
    CHECK (wallet_default_validity_days IS NULL OR wallet_default_validity_days > 0);
ALTER TABLE pos.pos_loyalty_settings
  ADD COLUMN IF NOT EXISTS wallet_expiry_reminder_days integer NOT NULL DEFAULT 7
    CHECK (wallet_expiry_reminder_days >= 0);
ALTER TABLE pos.pos_loyalty_settings
  ADD COLUMN IF NOT EXISTS topup_max_amount numeric(14,2) NOT NULL DEFAULT 10000000;

-- 4. Kedaluwarsa default untuk kredit yang ditulis kode lain -----------------
-- Kredit (topup, topup_bonus, bonus, refund) yang tidak menyebut masa berlaku
-- sendiri (metadata.validity_days) mengikuti wallet_default_validity_days.
CREATE OR REPLACE FUNCTION pos.wallet_apply_default_expiry() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_days integer;
BEGIN
  IF NEW.type NOT IN ('topup', 'topup_bonus', 'bonus', 'refund')
     OR NEW.status <> 'completed'
     OR NEW.expires_at IS NOT NULL
     OR COALESCE(NEW.metadata, '{}'::jsonb) ? 'validity_days' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;
  SELECT wallet_default_validity_days INTO v_days
    FROM pos.pos_loyalty_settings WHERE is_active ORDER BY updated_at DESC LIMIT 1;
  IF v_days IS NOT NULL THEN
    NEW.expires_at := now() + make_interval(days => v_days);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_default_expiry ON pos.pos_wallet_transactions;
CREATE TRIGGER trg_wallet_default_expiry
  BEFORE INSERT OR UPDATE OF status ON pos.pos_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION pos.wallet_apply_default_expiry();

-- 5. Jejak pengingat & sapuan ----------------------------------------------
CREATE TABLE IF NOT EXISTS pos.pos_wallet_lot_reminders (
  lot_id uuid PRIMARY KEY REFERENCES pos.pos_wallet_transactions(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  remaining_idr numeric(14,2) NOT NULL,
  wa_sent boolean NOT NULL DEFAULT false,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pos.pos_wallet_low_balance_nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  balance_idr numeric(14,2) NOT NULL,
  threshold_idr numeric(14,2) NOT NULL,
  wa_sent boolean NOT NULL DEFAULT false,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_wallet_nudges_customer
  ON pos.pos_wallet_low_balance_nudges (customer_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS pos.pos_wallet_sweep_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL CHECK (trigger IN ('auto', 'manual')),
  actor_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  expired_lots integer NOT NULL DEFAULT 0,
  expired_idr numeric(14,2) NOT NULL DEFAULT 0,
  reminders_sent integer NOT NULL DEFAULT 0,
  nudges_sent integer NOT NULL DEFAULT 0,
  error text
);
CREATE INDEX IF NOT EXISTS idx_pos_wallet_sweep_runs_started
  ON pos.pos_wallet_sweep_runs (started_at DESC);

-- 6. Menu dashboard: POS → Member → Dompet ----------------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('pos.loyalty.wallet', 'Dompet Member', '/dashboard/pos/wallet', 'banknotes', 'sidebar', 30, '{"actions":["read","create","update"]}'::jsonb),
  ('pos.loyalty.wallet.packages', 'Paket Top-up', '/dashboard/pos/wallet/packages', 'package', 'sidebar', 31, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('pos.loyalty.wallet.payments', 'Pembayaran Online', '/dashboard/pos/wallet/payments', 'credit-card', 'sidebar', 32, '{"actions":["read","update"]}'::jsonb),
  ('pos.loyalty.wallet.settings', 'Aturan Saldo', '/dashboard/pos/wallet/settings', 'settings', 'sidebar', 33, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'pos', level = 3 WHERE code LIKE 'pos.loyalty.wallet%';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code LIKE 'pos.loyalty.wallet%' AND parent.code = 'pos.loyalty';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'pos_supervisor')
  AND m.code LIKE 'pos.loyalty.wallet%'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
