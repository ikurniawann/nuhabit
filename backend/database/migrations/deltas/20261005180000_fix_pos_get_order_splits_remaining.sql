-- =============================================================================
-- POS split bill: pos_get_order_splits counts the applied amount, not the cash
-- tendered
-- =============================================================================
-- pos_order_splits.amount_paid is what the guest handed over and
-- change_amount what went back. total_paid summed amount_paid and
-- total_remaining subtracted it from the split totals, so a cash split paid
-- 30000 for 25000 counted 5000 of change as paid and drove the remaining
-- balance negative once the other splits were settled or cancelled.
--
-- A split now applies LEAST(total_amount, amount_paid - change_amount), never
-- below zero. total_paid sums it over paid splits; total_remaining sums each
-- active split's GREATEST(total_amount - applied, 0).
--
-- Proven by TestSplitBillFlow (possales/sales).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pos_get_order_splits(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  WITH applied AS (
    SELECT s.status, s.total_amount,
           LEAST(s.total_amount, GREATEST(s.amount_paid - s.change_amount, 0)) AS applied_amount
      FROM pos_order_splits s
     WHERE s.order_id = p_order_id
  )
  SELECT jsonb_build_object(
    'success', true,
    'splits', COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'label', s.label,
        'split_index', s.split_index,
        'total_amount', s.total_amount,
        'amount_paid', s.amount_paid,
        'change_amount', s.change_amount,
        'tax_amount', s.tax_amount,
        'discount_amount', s.discount_amount,
        'payment_method', s.payment_method,
        'status', s.status,
        'customer_id', s.customer_id,
        'ark_coins_used', s.ark_coins_used,
        'paid_at', s.paid_at,
        'created_at', s.created_at
      ) ORDER BY s.split_index
    ), '[]'::jsonb),
    'total_paid', (
      SELECT COALESCE(SUM(applied_amount), 0) FROM applied WHERE status = 'paid'
    ),
    'total_remaining', (
      SELECT COALESCE(SUM(GREATEST(total_amount - applied_amount, 0)), 0)
        FROM applied
       WHERE status != 'cancelled'
    ),
    'split_count', (SELECT COUNT(*) FROM pos_order_splits WHERE order_id = p_order_id),
    'paid_count', (SELECT COUNT(*) FROM pos_order_splits WHERE order_id = p_order_id AND status = 'paid')
  )
  FROM pos_order_splits s
  WHERE s.order_id = p_order_id;
$function$;
