-- POS: nomor antrian harian + journal mapping sale yang balance (diskon/SC/tax 0)

ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS queue_number varchar(8);

COMMENT ON COLUMN pos.pos_orders.queue_number IS
  'Nomor antrian pendek harian per company/branch (001, 002…). Generate sekali saat open bill atau payment.';

-- timezone()/now() tidak IMMUTABLE → tidak boleh di expression index.
CREATE OR REPLACE FUNCTION public.pos_jkt_date(ts timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT (ts AT TIME ZONE 'Asia/Jakarta')::date;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_orders_queue_daily
  ON pos.pos_orders (
    (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (public.pos_jkt_date(ordered_at)),
    queue_number
  )
  WHERE queue_number IS NOT NULL AND ordered_at IS NOT NULL;

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

  SELECT COALESCE(MAX(CAST(queue_number AS integer)), 0)
  INTO seq_num
  FROM pos.pos_orders
  WHERE queue_number ~ '^[0-9]+$'
    AND public.pos_jkt_date(COALESCE(ordered_at, now())) = today_jkt
    AND company_id IS NOT DISTINCT FROM p_company_id
    AND branch_id IS NOT DISTINCT FROM p_branch_id;

  new_number := LPAD((seq_num + 1)::text, 3, '0');
  RETURN new_number;
END;
$function$;

-- TAX/DISCOUNT/SC optional supaya ticket tax=0 atau tanpa diskon tidak draft
UPDATE accounting.journal_mapping_lines l
SET is_required = false,
    updated_at = now()
FROM accounting.journal_mappings m
WHERE l.mapping_id = m.id
  AND m.deleted_at IS NULL
  AND m.event_code LIKE 'POS_%'
  AND l.amount_source IN ('TAX', 'DISCOUNT', 'SERVICE_CHARGE')
  AND l.is_required = true;

INSERT INTO accounting.journal_mapping_lines (
  mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required
)
SELECT m.id, v.entry_side, v.line_role, NULL, v.amount_source, v.sort_order, false
FROM accounting.journal_mappings m
JOIN (
  VALUES
    ('POS_SALE_CASH', 'DEBIT', 'DISCOUNT', 'DISCOUNT', 15),
    ('POS_SALE_CASH', 'CREDIT', 'OTHER', 'SERVICE_CHARGE', 40),
    ('POS_SALE_QRIS', 'DEBIT', 'DISCOUNT', 'DISCOUNT', 15),
    ('POS_SALE_QRIS', 'CREDIT', 'OTHER', 'SERVICE_CHARGE', 40),
    ('POS_SALE_DEBIT', 'DEBIT', 'DISCOUNT', 'DISCOUNT', 15),
    ('POS_SALE_DEBIT', 'CREDIT', 'OTHER', 'SERVICE_CHARGE', 40),
    ('POS_SALE_CREDIT', 'DEBIT', 'DISCOUNT', 'DISCOUNT', 15),
    ('POS_SALE_CREDIT', 'CREDIT', 'OTHER', 'SERVICE_CHARGE', 40),
    ('POS_SALE_ARK_COIN', 'DEBIT', 'DISCOUNT', 'DISCOUNT', 15),
    ('POS_SALE_ARK_COIN', 'CREDIT', 'OTHER', 'SERVICE_CHARGE', 40),
    ('POS_SALE_GIFT_CARD', 'DEBIT', 'DISCOUNT', 'DISCOUNT', 15),
    ('POS_SALE_GIFT_CARD', 'CREDIT', 'OTHER', 'SERVICE_CHARGE', 40)
) AS v(event_code, entry_side, line_role, amount_source, sort_order)
  ON m.event_code = v.event_code
WHERE m.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM accounting.journal_mapping_lines l
    WHERE l.mapping_id = m.id
      AND l.line_role = v.line_role
      AND l.amount_source = v.amount_source
  );

WITH coa AS (
  SELECT id, code
  FROM accounting.chart_of_accounts
  WHERE deleted_at IS NULL
    AND is_postable = true
    AND is_active = true
    AND company_id IS NULL
),
pick AS (
  SELECT (SELECT id FROM coa WHERE code = '4101001' LIMIT 1) AS revenue_id
)
UPDATE accounting.journal_mapping_lines l
SET account_id = pick.revenue_id,
    updated_at = now()
FROM accounting.journal_mappings m, pick
WHERE l.mapping_id = m.id
  AND m.deleted_at IS NULL
  AND m.event_code LIKE 'POS_SALE_%'
  AND l.account_id IS NULL
  AND pick.revenue_id IS NOT NULL
  AND (
    (l.line_role = 'DISCOUNT' AND l.amount_source = 'DISCOUNT')
    OR (l.line_role = 'OTHER' AND l.amount_source = 'SERVICE_CHARGE')
  );
