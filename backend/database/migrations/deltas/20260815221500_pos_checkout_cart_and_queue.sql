-- Mixed checkout: persist cart for QRIS complete; allow child orders to share
-- the guest queue_number copied from pos_checkouts.

ALTER TABLE pos.pos_checkouts
  ADD COLUMN IF NOT EXISTS cart_snapshot jsonb;

COMMENT ON COLUMN pos.pos_checkouts.cart_snapshot IS
  'Snapshot keranjang campur (items + stall map) untuk completeMixedCheckout setelah QRIS lunas.';

DROP INDEX IF EXISTS pos.uq_pos_orders_queue_daily;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_orders_queue_daily
  ON pos.pos_orders (
    (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (public.pos_jkt_date(ordered_at)),
    queue_number
  )
  WHERE queue_number IS NOT NULL
    AND ordered_at IS NOT NULL
    AND checkout_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_checkouts_queue_daily
  ON pos.pos_checkouts (
    (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (public.pos_jkt_date(created_at)),
    queue_number
  )
  WHERE queue_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_queue_number(
  p_company_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
  today_jkt date;
  seq_num integer;
  new_number text;
  lock_key integer;
BEGIN
  today_jkt := public.pos_jkt_date(now());
  lock_key := hashtext(
    'pos_queue:'
    || COALESCE(p_company_id::text, 'g')
    || ':'
    || COALESCE(p_branch_id::text, 'g')
    || ':'
    || today_jkt::text
  );
  PERFORM pg_advisory_xact_lock(lock_key);

  SELECT COALESCE(MAX(CAST(q AS integer)), 0)
  INTO seq_num
  FROM (
    SELECT queue_number AS q
    FROM pos.pos_orders
    WHERE queue_number ~ '^[0-9]+$'
      AND public.pos_jkt_date(COALESCE(ordered_at, now())) = today_jkt
      AND company_id IS NOT DISTINCT FROM p_company_id
      AND branch_id IS NOT DISTINCT FROM p_branch_id
    UNION ALL
    SELECT queue_number AS q
    FROM pos.pos_checkouts
    WHERE queue_number ~ '^[0-9]+$'
      AND public.pos_jkt_date(created_at) = today_jkt
      AND company_id IS NOT DISTINCT FROM p_company_id
      AND branch_id IS NOT DISTINCT FROM p_branch_id
  ) numbered;

  new_number := LPAD((seq_num + 1)::text, 3, '0');
  RETURN new_number;
END;
$function$;
