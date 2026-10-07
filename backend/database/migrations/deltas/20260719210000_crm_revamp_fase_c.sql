-- EPIC-011 Fase C: topup member-kartu-only + bonus topup dari konfigurasi
-- (baris wallet topup_bonus terpisah) + produk privilege ber-syarat min_xp.
--
-- Catatan desain: syarat min_tier TIDAK dibuat — tier ditentukan lifetime XP
-- (min_lifetime_xp), jadi min_xp saja sudah ekuivalen & lebih sederhana.

-- 1. Produk privilege: NULL = produk umum; terisi = hanya member dgn
--    total_xp >= min_xp yang boleh membeli (bayar normal, XP tak dipotong).
ALTER TABLE pos.pos_products
  ADD COLUMN IF NOT EXISTS min_xp integer CHECK (min_xp IS NULL OR min_xp >= 0);

COMMENT ON COLUMN pos.pos_products.min_xp IS
  'Syarat privilege member: minimal lifetime XP utk boleh membeli. NULL = produk umum.';

-- 2. RPC topup v2: tolak member non-kartu + bonus topup terpisah.
--    Bonus non-refundable, TIDAK menambah total_spent, dicatat sebagai baris
--    wallet type 'topup_bonus' agar akuntansi bisa memisahkan.
--    DROP signature lama WAJIB — parameter baru = overload; tanpa drop,
--    pemanggil 6-arg tetap kena fungsi lama TANPA cek member kartu.
DROP FUNCTION IF EXISTS public.process_ark_topup(uuid, numeric, text, text, uuid, uuid);
CREATE OR REPLACE FUNCTION public.process_ark_topup(
  p_customer_id uuid,
  p_amount numeric,
  p_payment_method text DEFAULT 'qris',
  p_xendit_transaction_id text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_bonus_percent numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_member_type text;
  v_balance_before numeric(12,2);
  v_after_topup numeric(12,2);
  v_balance_after numeric(12,2);
  v_bonus numeric(12,2);
  v_tx_id uuid;
  v_bonus_tx_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Topup amount must be positive';
  END IF;

  SELECT ark_coin_balance, member_type
  INTO v_balance_before, v_member_type
  FROM pos.pos_customers
  WHERE id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id;
  END IF;

  -- Keputusan owner #8: topup HANYA utk member kartu (NFC tertaut).
  IF v_member_type IS DISTINCT FROM 'card' THEN
    RAISE EXCEPTION 'CARD_MEMBER_ONLY';
  END IF;

  v_balance_before := COALESCE(v_balance_before, 0);
  v_bonus := COALESCE(round(p_amount * COALESCE(p_bonus_percent, 0) / 100.0, 2), 0);
  v_after_topup := v_balance_before + p_amount;
  v_balance_after := v_after_topup + v_bonus;

  UPDATE pos.pos_customers
  SET ark_coin_balance = v_balance_after,
      updated_at = now()
  WHERE id = p_customer_id;

  INSERT INTO pos.pos_wallet_transactions (
    customer_id, type, amount, ark_coins, balance_before, balance_after,
    payment_method, xendit_transaction_id, notes, company_id, branch_id
  ) VALUES (
    p_customer_id, 'topup', p_amount, p_amount / 1000,
    v_balance_before, v_after_topup,
    p_payment_method::public.pos_payment_method, p_xendit_transaction_id,
    'Topup via ' || upper(p_payment_method), p_company_id, p_branch_id
  ) RETURNING id INTO v_tx_id;

  IF v_bonus > 0 THEN
    INSERT INTO pos.pos_wallet_transactions (
      customer_id, type, amount, ark_coins, balance_before, balance_after,
      payment_method, xendit_transaction_id, notes, company_id, branch_id
    ) VALUES (
      p_customer_id, 'topup_bonus', v_bonus, v_bonus / 1000,
      v_after_topup, v_balance_after,
      p_payment_method::public.pos_payment_method, NULL,
      'Bonus topup ' || COALESCE(p_bonus_percent, 0)::text || '%',
      p_company_id, p_branch_id
    ) RETURNING id INTO v_bonus_tx_id;
  END IF;

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'bonus_transaction_id', v_bonus_tx_id,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after,
    'topup_amount', p_amount,
    'bonus_amount', v_bonus,
    'ark_coins', v_balance_after - v_balance_before
  );
END;
$$;
