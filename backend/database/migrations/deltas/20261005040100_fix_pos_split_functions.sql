-- =============================================================================
-- POS split bill: rebuild pos_create_split_order_transaction and pos_cancel_split
-- =============================================================================
-- Both functions came from the old schema and failed on every database built
-- from the current migrations, in the TS routes and the Go port alike:
--   * pos_order_items has no variant_info / modifier_info / notes columns
--     (they are variants / modifiers jsonb and kitchen_notes);
--   * pos_order_status_history has no status / reason columns (it has
--     from_status, to_status, changed_by NOT NULL and notes);
--   * pos_orders.order_type / cashier_id / server_id are an enum and uuids,
--     and text parameters do not cast to them implicitly;
--   * format() has no %.2f, so the total check raised instead of answering.
-- p_table_id and p_branch_id were accepted and never stored.
--
-- p_items and p_splits become jsonb[]: node-postgres sends a JS array as a
-- Postgres array literal of JSON texts, which jsonb[] parses and jsonb
-- rejects. The Go port passes ARRAY(SELECT jsonb_array_elements(...)).
--
-- Order lines follow buildOrderItemRows (lib/pos/orders/order-pricing.ts):
-- unit price includes the variant and modifier adjustments, an empty
-- quantity is 1, and the cost snapshot comes from pos_products.cost_price.
-- A station outside the CHECK list is left NULL for the caller's
-- backfillMissingItemStations. Split totals must match the order total to
-- the rupiah, like POST /api/pos/orders/{id}/splits.
--
-- Proven by TestCreateSplitOrder and TestSplitBillFlow (possales/sales).
-- =============================================================================

DROP FUNCTION IF EXISTS public.pos_create_split_order_transaction(
  text, text, uuid, text, text, jsonb, numeric, numeric, text, numeric, numeric, numeric, text, text, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.pos_create_split_order_transaction(
  p_order_type text,
  p_cashier_id text,
  p_customer_id uuid DEFAULT NULL,
  p_server_id text DEFAULT NULL,
  p_table_id text DEFAULT NULL,
  p_items jsonb[] DEFAULT '{}',
  p_subtotal numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_discount_reason text DEFAULT NULL,
  p_tax_amount numeric DEFAULT 0,
  p_service_charge_amount numeric DEFAULT 0,
  p_total_amount numeric DEFAULT 0,
  p_notes text DEFAULT NULL,
  p_special_requests text DEFAULT NULL,
  p_splits jsonb[] DEFAULT '{}',
  p_branch_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pos
AS $function$
DECLARE
  v_cashier uuid := NULLIF(p_cashier_id, '')::uuid;
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_item_ids uuid[] := '{}';
  v_item_prices numeric[] := '{}';
  v_item_id uuid;
  v_qty numeric;
  v_unit numeric;
  v_subtotal numeric;
  v_discount numeric;
  v_total numeric;
  v_cost numeric;
  v_cost_total numeric;
  v_split jsonb;
  v_split_id uuid;
  v_split_index integer := 0;
  v_split_count integer := COALESCE(cardinality(p_splits), 0);
  v_sum_splits numeric;
  v_map jsonb;
  v_map_idx integer;
  v_map_qty integer;
  v_map_unit numeric;
BEGIN
  IF v_split_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'splits array cannot be empty for split bill');
  END IF;
  IF COALESCE(cardinality(p_items), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'items array cannot be empty for split bill');
  END IF;

  SELECT COALESCE(sum(NULLIF(s ->> 'total_amount', '')::numeric), 0) INTO v_sum_splits
  FROM unnest(p_splits) AS s;
  IF round(v_sum_splits) <> round(COALESCE(p_total_amount, 0)) THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Total split %s tidak sama dengan total order %s', trim_scale(v_sum_splits), trim_scale(COALESCE(p_total_amount, 0))));
  END IF;

  v_order_number := generate_order_number();

  INSERT INTO pos_orders (
    order_number, order_type, status, payment_status,
    customer_id, cashier_id, server_id, table_id, branch_id,
    subtotal, discount_amount, discount_reason,
    tax_amount, service_charge_amount, total_amount,
    amount_paid, change_amount, notes, special_requests, ordered_at
  ) VALUES (
    v_order_number, COALESCE(NULLIF(p_order_type, ''), 'dine_in')::pos_order_type, 'pending', 'unpaid',
    p_customer_id, v_cashier, NULLIF(p_server_id, '')::uuid, NULLIF(p_table_id, ''), p_branch_id,
    COALESCE(p_subtotal, 0), COALESCE(p_discount_amount, 0), p_discount_reason,
    COALESCE(p_tax_amount, 0), COALESCE(p_service_charge_amount, 0), p_total_amount,
    0, 0, p_notes, p_special_requests, now()
  ) RETURNING id INTO v_order_id;

  FOREACH v_item IN ARRAY p_items
  LOOP
    v_qty := COALESCE(NULLIF(NULLIF(v_item ->> 'quantity', '')::numeric, 0), 1);
    v_unit := COALESCE(NULLIF(v_item ->> 'unit_price', '')::numeric, 0)
            + COALESCE(NULLIF(v_item ->> 'variant_price_adjustment', '')::numeric, 0)
            + COALESCE(NULLIF(v_item ->> 'modifier_price_adjustment', '')::numeric, 0);
    v_subtotal := v_unit * v_qty;
    v_discount := COALESCE(NULLIF(v_item ->> 'discount_amount', '')::numeric, 0);
    v_total := COALESCE(NULLIF(v_item ->> 'total_amount', '')::numeric, v_subtotal - v_discount);
    SELECT COALESCE(p.cost_price, 0) INTO v_cost
    FROM pos_products p WHERE p.id = NULLIF(v_item ->> 'product_id', '')::uuid;
    v_cost := COALESCE(v_cost, 0);
    v_cost_total := round(v_cost * v_qty, 2);

    INSERT INTO pos_order_items (
      order_id, product_id, sku_id, product_name, product_sku,
      variants, modifiers, quantity, unit_price, subtotal,
      discount_type, discount_value, discount_amount, total_amount,
      station, kitchen_status, kitchen_notes,
      cost_price, cost_total, gross_profit, gross_margin_pct
    ) VALUES (
      v_order_id,
      NULLIF(v_item ->> 'product_id', '')::uuid,
      NULLIF(v_item ->> 'sku_id', '')::uuid,
      COALESCE(NULLIF(v_item ->> 'product_name', ''), 'Unknown'),
      left(COALESCE(NULLIF(v_item ->> 'product_sku', ''), v_item ->> 'product_id', ''), 50),
      CASE WHEN jsonb_typeof(v_item -> 'variants') = 'array' THEN v_item -> 'variants' ELSE '[]'::jsonb END,
      CASE WHEN jsonb_typeof(v_item -> 'modifiers') = 'array' THEN v_item -> 'modifiers' ELSE '[]'::jsonb END,
      v_qty, v_unit, v_subtotal,
      CASE WHEN v_item ->> 'discount_type' IN ('percent', 'fixed') THEN v_item ->> 'discount_type' END,
      NULLIF(v_item ->> 'discount_value', '')::numeric,
      v_discount, v_total,
      CASE WHEN v_item ->> 'station' IN ('kitchen', 'bar', 'bakery', 'dessert', 'merchandise', 'photobooth')
           THEN v_item ->> 'station' END,
      'pending',
      NULLIF(v_item ->> 'notes', ''),
      v_cost, v_cost_total, round(v_total - v_cost_total, 2),
      CASE WHEN v_total > 0 THEN round((v_total - v_cost_total) / v_total * 100, 2) ELSE 0 END
    ) RETURNING id INTO v_item_id;

    v_item_ids := v_item_ids || v_item_id;
    v_item_prices := v_item_prices || v_unit;
  END LOOP;

  FOREACH v_split IN ARRAY p_splits
  LOOP
    v_split_index := v_split_index + 1;
    INSERT INTO pos_order_splits (
      order_id, split_index, label, subtotal, tax_amount, discount_amount,
      total_amount, customer_id, status
    ) VALUES (
      v_order_id, v_split_index,
      COALESCE(NULLIF(v_split ->> 'label', ''), 'Split ' || v_split_index),
      COALESCE(NULLIF(v_split ->> 'subtotal', '')::numeric, 0),
      COALESCE(NULLIF(v_split ->> 'tax_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_split ->> 'discount_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_split ->> 'total_amount', '')::numeric, 0),
      NULLIF(v_split ->> 'customer_id', '')::uuid,
      'pending'
    ) RETURNING id INTO v_split_id;

    IF jsonb_typeof(v_split -> 'items') = 'array' THEN
      FOR v_map IN SELECT value FROM jsonb_array_elements(v_split -> 'items')
      LOOP
        v_map_idx := NULLIF(v_map ->> 'order_item_index', '')::integer;
        v_map_qty := floor(COALESCE(NULLIF(v_map ->> 'quantity', '')::numeric, 0));
        CONTINUE WHEN v_map_idx IS NULL OR v_map_idx < 0 OR v_map_idx >= cardinality(v_item_ids) OR v_map_qty <= 0;
        v_map_unit := COALESCE(NULLIF(NULLIF(v_map ->> 'unit_price', '')::numeric, 0), v_item_prices[v_map_idx + 1]);
        INSERT INTO pos_order_split_items (split_id, order_item_id, quantity, subtotal, total_amount)
        VALUES (v_split_id, v_item_ids[v_map_idx + 1], v_map_qty, v_map_unit * v_map_qty, v_map_unit * v_map_qty);
      END LOOP;
    END IF;
  END LOOP;

  IF v_cashier IS NOT NULL THEN
    INSERT INTO pos_order_status_history (order_id, from_status, to_status, changed_by, notes)
    VALUES (v_order_id, NULL, 'pending', v_cashier, format('Split bill order created: %s bill(s)', v_split_count));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'split_count', v_split_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.pos_cancel_split(p_split_id uuid, p_cashier_id text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pos
AS $function$
DECLARE
  v_split pos_order_splits%ROWTYPE;
  v_order_status pos_order_status;
  v_cashier uuid := NULLIF(p_cashier_id, '')::uuid;
BEGIN
  SELECT * INTO v_split FROM pos_order_splits WHERE id = p_split_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Split not found');
  END IF;
  IF v_split.status IN ('paid', 'partial') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot cancel paid split');
  END IF;
  IF v_split.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Split already cancelled');
  END IF;

  UPDATE pos_order_splits SET status = 'cancelled' WHERE id = p_split_id;

  -- The order itself keeps its status: history records the event only.
  IF v_cashier IS NOT NULL THEN
    SELECT status INTO v_order_status FROM pos_orders WHERE id = v_split.order_id;
    INSERT INTO pos_order_status_history (order_id, from_status, to_status, changed_by, notes)
    VALUES (v_split.order_id, v_order_status, v_order_status, v_cashier,
            format('Split %s cancelled', COALESCE(NULLIF(v_split.label, ''), v_split.split_index::text)));
  END IF;

  RETURN jsonb_build_object('success', true, 'split_id', p_split_id);
END;
$function$;
