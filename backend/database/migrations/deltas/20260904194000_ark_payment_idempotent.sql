-- Fix double-debit ARK Coin (insiden 2026-09-04).
--
-- Gejala: satu order punya 2 baris pos_wallet_transactions type=payment
-- berjarak ~1 detik (double PATCH / double RPC) sehingga saldo terpotong 2×.
--
-- Perbaikan: update_ark_coin_balance idempotent untuk payment penuh per order.
-- Jika sudah ada baris payment untuk order_id yang sama dengan notes default
-- ('payment' / kosong), RPC mengembalikan saldo saat ini tanpa memotong lagi.
-- Split payment (notes 'Split payment …') tidak terkena guard ini.

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
  v_notes text := COALESCE(NULLIF(BTRIM(p_notes), ''), p_type);
  v_existing uuid;
BEGIN
  -- Lock row for update to prevent race conditions
  SELECT ark_coin_balance INTO v_balance_before
  FROM pos.pos_customers
  WHERE id = p_customer_id
  FOR UPDATE;

  IF v_balance_before IS NULL THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id;
  END IF;

  -- Idempotent: payment penuh per order tidak boleh dipotong 2×.
  -- Catatan split ('Split payment …') boleh lebih dari satu per order.
  IF p_type = 'payment'
     AND p_order_id IS NOT NULL
     AND p_amount < 0
     AND (v_notes = 'payment' OR v_notes = p_type)
  THEN
    SELECT w.id INTO v_existing
    FROM pos.pos_wallet_transactions w
    WHERE w.order_id = p_order_id
      AND w.type = 'payment'
      AND COALESCE(NULLIF(BTRIM(w.notes), ''), 'payment') IN ('payment')
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      RETURN v_balance_before;
    END IF;
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
    v_balance_before, v_balance_after, p_order_id, v_notes,
    v_company_id, v_branch_id
  );

  RETURN v_balance_after;
END;
$$;
