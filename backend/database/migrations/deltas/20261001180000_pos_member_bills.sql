-- Tagihan Member (owner 2026-10-01): order member yang belum lunas dibayar
-- bertahap lewat POS → Operasional → Tagihan. Model DEPOSIT: tiap cicilan
-- dicatat di akun member (pos_member_bill_payments) tanpa menandai order
-- tertentu; saat total cicilan menutup seluruh order terbuka, semua order itu
-- ditutup sekaligus (pos_member_bill_settlements, payment_method 'member_bill').
--
-- Saldo deposit member = Σ cicilan − Σ settlements.orders_total.
-- Sisa tagihan        = Σ total order terbuka − saldo deposit.
--
-- Akuntansi: cicilan → POS_MEMBER_DEPOSIT_* (Kas/Bank ↔ Uang Muka Member);
-- penutupan order → POS_SALE_MEMBER_BILL (Uang Muka Member ↔ Penjualan/Pajak).

CREATE TABLE IF NOT EXISTS pos.pos_member_bill_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id),
  orders_total numeric(14, 2) NOT NULL CHECK (orders_total >= 0),
  order_count integer NOT NULL CHECK (order_count >= 0),
  settled_by uuid,
  settled_by_name text,
  company_id uuid,
  branch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_bill_settlements_customer
  ON pos.pos_member_bill_settlements (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pos.pos_member_bill_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  -- Kode dasar alur kasir (cash / qris / credit_card) + stempel katalog.
  payment_method text NOT NULL,
  payment_method_code text,
  payment_method_name text,
  reference_number text,
  notes text,
  shift_id uuid REFERENCES pos.pos_shifts(id),
  -- Cicilan yang membuat tagihan lunas (null = belum menutup order).
  settlement_id uuid REFERENCES pos.pos_member_bill_settlements(id),
  received_by uuid,
  received_by_name text,
  company_id uuid,
  branch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_bill_payments_customer
  ON pos.pos_member_bill_payments (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_bill_payments_shift
  ON pos.pos_member_bill_payments (shift_id) WHERE shift_id IS NOT NULL;

ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS member_bill_settlement_id uuid
    REFERENCES pos.pos_member_bill_settlements(id);

CREATE INDEX IF NOT EXISTS idx_pos_orders_member_bill_settlement
  ON pos.pos_orders (member_bill_settlement_id) WHERE member_bill_settlement_id IS NOT NULL;
-- Daftar tagihan: order member yang belum lunas.
CREATE INDEX IF NOT EXISTS idx_pos_orders_customer_unpaid
  ON pos.pos_orders (customer_id) WHERE payment_status = 'unpaid' AND customer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Menu POS → Operasional → Tagihan (+ akses role; pola seeder iam-menus /
-- iam-role-permissions — kode juga ditambahkan ke daftar canonical seeder).
-- ---------------------------------------------------------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context, module, level, parent_id, is_visible, is_active)
SELECT 'pos.operations.member-bills', 'Tagihan', '/dashboard/pos/member-bills', 'money', 'sidebar', 35,
       '{"actions":["read","create"]}'::jsonb, 'pos', 3, p.id, true, true
FROM iam.menus p
WHERE p.code = 'pos.operations' AND p.deleted_at IS NULL
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  parent_id = EXCLUDED.parent_id,
  is_active = true,
  deleted_at = NULL,
  updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id,
       CASE WHEN r.code IN ('super_admin', 'admin')
            THEN '["read","create","update","delete","approve","export","import","execute"]'::jsonb
            ELSE COALESCE(m.permission_context->'actions', '["read"]'::jsonb) END
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE m.code = 'pos.operations.member-bills'
  AND r.code IN ('super_admin', 'admin', 'pos', 'pos_supervisor')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Journal mapping (akun dipilih admin/akuntan di Accounting → Journal Mapping).
-- ---------------------------------------------------------------------------
INSERT INTO accounting.journal_mappings (company_id, event_code, name, description, module, is_active)
SELECT NULL, v.event_code, v.name, v.description, 'POS', true
FROM (
  VALUES
    ('POS_MEMBER_DEPOSIT_CASH', 'Tagihan Member — Cicilan Tunai',
     'Cicilan tagihan member diterima tunai (Kas ↔ Uang Muka Member)'),
    ('POS_MEMBER_DEPOSIT_QRIS', 'Tagihan Member — Cicilan QRIS',
     'Cicilan tagihan member via QRIS (Bank ↔ Uang Muka Member)'),
    ('POS_MEMBER_DEPOSIT_CARD', 'Tagihan Member — Cicilan Kartu/Transfer',
     'Cicilan tagihan member via kartu / metode non-tunai (Bank ↔ Uang Muka Member)'),
    ('POS_SALE_MEMBER_BILL', 'POS Sale — Tagihan Member',
     'Order member ditutup dari saldo cicilan (Uang Muka Member ↔ Penjualan)')
) AS v(event_code, name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM accounting.journal_mappings m
  WHERE m.event_code = v.event_code AND m.company_id IS NULL AND m.deleted_at IS NULL
);

INSERT INTO accounting.journal_mapping_lines (mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required)
SELECT m.id, v.entry_side, v.line_role, NULL, v.amount_source, v.sort_order, v.is_required
FROM accounting.journal_mappings m
JOIN (
  VALUES
    ('POS_MEMBER_DEPOSIT_CASH', 'DEBIT', 'CASH', 'TOTAL', 10, true),
    ('POS_MEMBER_DEPOSIT_CASH', 'CREDIT', 'MEMBER_DEPOSIT', 'TOTAL', 20, true),
    ('POS_MEMBER_DEPOSIT_QRIS', 'DEBIT', 'BANK', 'TOTAL', 10, true),
    ('POS_MEMBER_DEPOSIT_QRIS', 'CREDIT', 'MEMBER_DEPOSIT', 'TOTAL', 20, true),
    ('POS_MEMBER_DEPOSIT_CARD', 'DEBIT', 'BANK', 'TOTAL', 10, true),
    ('POS_MEMBER_DEPOSIT_CARD', 'CREDIT', 'MEMBER_DEPOSIT', 'TOTAL', 20, true),
    ('POS_SALE_MEMBER_BILL', 'DEBIT', 'MEMBER_DEPOSIT', 'TOTAL', 10, true),
    ('POS_SALE_MEMBER_BILL', 'DEBIT', 'DISCOUNT', 'DISCOUNT', 15, false),
    ('POS_SALE_MEMBER_BILL', 'CREDIT', 'REVENUE', 'SUBTOTAL', 20, true),
    ('POS_SALE_MEMBER_BILL', 'CREDIT', 'TAX', 'TAX', 30, false),
    ('POS_SALE_MEMBER_BILL', 'CREDIT', 'OTHER', 'SERVICE_CHARGE', 40, false)
) AS v(event_code, entry_side, line_role, amount_source, sort_order, is_required)
  ON v.event_code = m.event_code
WHERE m.company_id IS NULL AND m.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM accounting.journal_mapping_lines l
    WHERE l.mapping_id = m.id AND l.entry_side = v.entry_side AND l.line_role = v.line_role
  );
