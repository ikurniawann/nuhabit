-- EPIC-011 Fase E: laporan & rekonsiliasi antar-venue.
-- 1) RPC update_ark_coin_balance kini menstempel venue (company/branch) di
--    setiap baris wallet — derive dari order bila tidak dikirim, fallback ke
--    default venue crm_settings. (Acceptance: semua transaksi wallet baru
--    tercatat venue kejadiannya; prasyarat rekonsiliasi antar-venue.)
-- 2) Backfill venue baris wallet lama dari order terkait / default venue.
-- 3) Menu sidebar CRM → Laporan (/dashboard/crm/reports).

-- ============================================================
-- 1. RPC v2 dengan stempel venue
-- ============================================================
-- GOTCHA (pelajaran Fase C): parameter baru = signature baru = OVERLOAD.
-- Signature lama WAJIB di-DROP agar pemanggil 5-arg tidak jatuh ke fungsi
-- lama yang tidak menstempel venue.
DROP FUNCTION IF EXISTS public.update_ark_coin_balance(uuid, numeric, text, uuid, text);

CREATE OR REPLACE FUNCTION public.update_ark_coin_balance(
  p_customer_id uuid,
  p_amount numeric,
  p_type text DEFAULT 'payment',
  p_order_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance_before decimal(12,2);
  v_balance_after decimal(12,2);
  v_company_id uuid := p_company_id;
  v_branch_id uuid := p_branch_id;
BEGIN
  -- Lock row for update to prevent race conditions
  SELECT ark_coin_balance INTO v_balance_before
  FROM pos.pos_customers
  WHERE id = p_customer_id
  FOR UPDATE;

  IF v_balance_before IS NULL THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id;
  END IF;

  v_balance_after := v_balance_before + p_amount;

  -- Prevent negative balance on payment
  IF p_type = 'payment' AND v_balance_after < 0 THEN
    RAISE EXCEPTION 'Insufficient Ark Coin balance. Available: %, Required: %', v_balance_before, ABS(p_amount);
  END IF;

  -- Stempel venue: eksplisit > venue order > default venue crm_settings.
  IF v_company_id IS NULL AND p_order_id IS NOT NULL THEN
    SELECT o.company_id, o.branch_id INTO v_company_id, v_branch_id
    FROM pos.pos_orders o
    WHERE o.id = p_order_id;
  END IF;

  IF v_company_id IS NULL THEN
    SELECT (value #>> '{}')::uuid INTO v_company_id
    FROM crm.crm_settings WHERE key = 'default_company_id';
  END IF;

  IF v_branch_id IS NULL THEN
    SELECT (value #>> '{}')::uuid INTO v_branch_id
    FROM crm.crm_settings WHERE key = 'default_branch_id';
  END IF;

  UPDATE pos.pos_customers
  SET ark_coin_balance = v_balance_after,
      updated_at = now()
  WHERE id = p_customer_id;

  INSERT INTO pos.pos_wallet_transactions (
    customer_id, type, amount, ark_coins,
    balance_before, balance_after, order_id, notes,
    company_id, branch_id
  ) VALUES (
    p_customer_id, p_type, ABS(p_amount), ABS(p_amount),
    v_balance_before, v_balance_after, p_order_id, COALESCE(p_notes, p_type),
    v_company_id, v_branch_id
  );

  RETURN v_balance_after;
END;
$$;

-- ============================================================
-- 2. Backfill venue baris wallet lama
-- ============================================================
-- 2a. Dari order terkait (baris payment punya order_id).
UPDATE pos.pos_wallet_transactions w
SET company_id = o.company_id,
    branch_id = o.branch_id
FROM pos.pos_orders o
WHERE w.order_id = o.id
  AND w.company_id IS NULL
  AND o.company_id IS NOT NULL;

-- 2b. Sisanya (topup lama pra-Fase A dst) ke default venue.
UPDATE pos.pos_wallet_transactions w
SET company_id = (SELECT (value #>> '{}')::uuid FROM crm.crm_settings WHERE key = 'default_company_id'),
    branch_id = (SELECT (value #>> '{}')::uuid FROM crm.crm_settings WHERE key = 'default_branch_id')
WHERE w.company_id IS NULL;

-- Index bantu rekonsiliasi per venue + periode.
CREATE INDEX IF NOT EXISTS idx_pos_wallet_venue_created
  ON pos.pos_wallet_transactions (company_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_orders_customer_paid
  ON pos.pos_orders (customer_id, payment_status, created_at DESC);

-- ============================================================
-- 3. Menu sidebar: CRM → Laporan
-- ============================================================
-- Grup level 2
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('crm.reports', 'Laporan', NULL, 'bar-chart-3', 'group', 80, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'crm', level = 2 WHERE code = 'crm.reports';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'crm.reports' AND parent.code = 'crm';

-- Item sidebar level 3
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('crm.reports.overview', 'Laporan CRM', '/dashboard/crm/reports',
        'bar-chart-3', 'sidebar', 10, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'crm', level = 3 WHERE code = 'crm.reports.overview';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'crm.reports.overview' AND parent.code = 'crm.reports';

-- Grant selaras menu CRM lain (dashboard/members): super_admin, admin, direksi.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'direksi')
  AND m.code IN ('crm.reports', 'crm.reports.overview')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
