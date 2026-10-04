-- Unlink Card + Topup FOC (permintaan owner 2026-09-01).
--
-- 1. pos.pos_card_unlink_logs — jejak audit setiap kartu NFC yang dilepas
--    dari member (alasan: hilang / dikembalikan / lainnya). Saldo ARK & XP
--    member TIDAK disentuh saat unlink — hanya nfc_uid yang dikosongkan
--    sehingga kartu lama tidak bisa dipakai lagi.
-- 2. Menu Point of Sales → Member → Unlink Card.
-- 3. Topup FOC memakai kolom pos_wallet_transactions.payment_method = 'foc'
--    (tanpa perubahan skema; dibedakan lewat nilai + metadata).

CREATE TABLE IF NOT EXISTS pos.pos_card_unlink_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  nfc_uid varchar(64) NOT NULL,
  reason varchar(20) NOT NULL CHECK (reason IN ('lost', 'returned', 'other')),
  notes text,
  balance_at_unlink numeric(14,2) NOT NULL DEFAULT 0,
  unlinked_by uuid,
  unlinked_by_name varchar(120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_card_unlink_logs_customer
  ON pos.pos_card_unlink_logs(customer_id, created_at DESC);

-- Menu: POS → Member → Unlink Card (di antara Topup=10 dan ARK & XP=20)
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('pos.loyalty.unlink-card', 'Unlink Card', '/dashboard/pos/unlink-card',
        'credit-card', 'sidebar', 15, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'pos', level = 3 WHERE code = 'pos.loyalty.unlink-card';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'pos.loyalty.unlink-card' AND parent.code = 'pos.loyalty';

-- Hak akses: cerminkan siapa pun yang boleh membuka Topup (grup Member yg sama)
INSERT INTO iam.role_menu_permissions (role_id, menu_id, is_active, granted_actions)
SELECT rmp.role_id, m.id, true, COALESCE(rmp.granted_actions, '["read","update"]'::jsonb)
FROM iam.role_menu_permissions rmp
JOIN iam.menus topup ON topup.id = rmp.menu_id AND topup.code = 'pos.loyalty.topup'
CROSS JOIN iam.menus m
WHERE m.code = 'pos.loyalty.unlink-card' AND rmp.is_active
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, '["read","update"]'::jsonb, true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin') AND m.code = 'pos.loyalty.unlink-card'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
