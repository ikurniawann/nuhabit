-- =============================================================================
-- Landed cost: additional purchase costs flow into stock value and the books
-- =============================================================================
-- An active purchasing.cogs_additional_costs row (freight, duty, ...) on a PO
-- or GRN used to raise only the COGS estimate. It now joins the value of the
-- raw materials it brought in:
--
--   * inventory.apply_landed_costs(cost_ids, grn_ids, user_id) allocates each
--     cost to the raw material lines of its document whose stock is posted
--     (a GRN 'in' movement exists): line value qty_qc_posted x PO price over
--     the document basis (a PO cost: the PO's ordered value; a GRN cost: the
--     GRN's received value). The difference between that target and what was
--     allocated before goes into the receiving balance's weighted average
--     cost (and the receipt batch); with no stock left to carry it, it is
--     expensed. Every step is a row of inventory.landed_cost_allocations, so a
--     deleted cost reverses exactly what it added. It returns one row per
--     cost that moved: the amount capitalized and the amount expensed.
--   * Callers (Go and TS) run it when a cost is created or deleted and when a
--     GRN posts stock, then post PURCHASE_LANDED_COST (debit inventory, debit
--     COGS for the expensed part, credit AP) or PURCHASE_LANDED_COST_REVERSAL
--     for the opposite movement, keyed by the batch id.
--   * The COGS estimate only adds the part of a cost not allocated yet.
--
-- Shares of supply or merchandise lines are not allocated: costs follow raw
-- materials. Proven by TestLandedCostCapitalization (inventory) and
-- TestLandedCostJournals (accounting).
-- =============================================================================

CREATE TABLE IF NOT EXISTS inventory.landed_cost_allocations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id        uuid NOT NULL,
    cost_id         uuid NOT NULL REFERENCES purchasing.cogs_additional_costs(id),
    grn_id          uuid NOT NULL,
    grn_item_id     uuid NOT NULL,
    raw_material_id uuid NOT NULL,
    inventory_id    uuid REFERENCES inventory.inventory(id) ON DELETE SET NULL,
    -- Change of the line's allocation; capitalized + expensed = amount.
    amount          numeric(15,2) NOT NULL,
    capitalized     numeric(15,2) NOT NULL,
    expensed        numeric(15,2) NOT NULL,
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory.landed_cost_allocations IS
  'Langkah alokasi biaya tambahan pembelian ke stok bahan baku (append-only; jumlah per baris GRN = alokasi saat ini).';

CREATE INDEX IF NOT EXISTS idx_landed_cost_allocations_cost ON inventory.landed_cost_allocations (cost_id, grn_item_id);
CREATE INDEX IF NOT EXISTS idx_landed_cost_allocations_grn ON inventory.landed_cost_allocations (grn_id);

CREATE OR REPLACE FUNCTION inventory.apply_landed_costs(p_cost_ids uuid[], p_grn_ids uuid[], p_user_id uuid)
 RETURNS TABLE (batch_id uuid, cost_id uuid, company_id uuid, capitalized numeric, expensed numeric)
 LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
DECLARE
  c record;
  l record;
  v_inv record;
  v_amount numeric;
  v_basis numeric;
  v_company uuid;
  v_batch uuid;
  v_delta numeric;
  v_cap numeric;
  v_exp numeric;
  v_cap_total numeric;
  v_exp_total numeric;
BEGIN
  FOR c IN
    SELECT ac.id, ac.reference_type, ac.reference_id, ac.is_active,
           COALESCE(ac.jumlah_idr, round(ac.jumlah * COALESCE(ac.exchange_rate, 1), 2)) AS amount
      FROM purchasing.cogs_additional_costs ac
     WHERE ac.id = ANY(COALESCE(p_cost_ids, '{}'::uuid[]))
        OR (ac.is_active AND (
              (ac.reference_type = 'GRN' AND ac.reference_id = ANY(COALESCE(p_grn_ids, '{}'::uuid[])))
           OR (ac.reference_type = 'PO' AND ac.reference_id IN (
                 SELECT g.purchase_order_id FROM purchasing.grn g WHERE g.id = ANY(COALESCE(p_grn_ids, '{}'::uuid[]))))))
     ORDER BY ac.id
       FOR UPDATE OF ac
  LOOP
    v_amount := CASE WHEN c.is_active THEN c.amount ELSE 0 END;
    IF c.reference_type = 'PO' THEN
      SELECT COALESCE(sum(poi.qty_ordered * poi.harga_satuan), 0) INTO v_basis
        FROM purchasing.purchase_order_items poi
       WHERE poi.purchase_order_id = c.reference_id AND poi.is_active;
      SELECT po.company_id INTO v_company FROM purchasing.purchase_orders po WHERE po.id = c.reference_id;
    ELSE
      SELECT COALESCE(sum(gi.qty_diterima * poi.harga_satuan), 0) INTO v_basis
        FROM purchasing.grn_items gi
        JOIN purchasing.purchase_order_items poi ON poi.id = gi.purchase_order_item_id
       WHERE gi.grn_id = c.reference_id AND gi.is_active;
      SELECT COALESCE(g.company_id, po.company_id) INTO v_company
        FROM purchasing.grn g LEFT JOIN purchasing.purchase_orders po ON po.id = g.purchase_order_id
       WHERE g.id = c.reference_id;
    END IF;

    v_batch := gen_random_uuid();
    v_cap_total := 0;
    v_exp_total := 0;
    FOR l IN
      WITH lines AS (
        SELECT gi.id AS grn_item_id, gi.grn_id, gi.raw_material_id,
               gi.qty_qc_posted * poi.harga_satuan AS value,
               (SELECT m.id FROM inventory.inventory_movements m
                 WHERE m.reference_type = 'grn' AND m.reference_id = gi.grn_id
                   AND m.raw_material_id = gi.raw_material_id AND m.tipe = 'in'
                 ORDER BY m.created_at DESC LIMIT 1) AS movement_id
          FROM purchasing.grn_items gi
          JOIN purchasing.grn g ON g.id = gi.grn_id AND g.is_active
          JOIN purchasing.purchase_order_items poi ON poi.id = gi.purchase_order_item_id
         WHERE gi.is_active AND gi.raw_material_id IS NOT NULL AND gi.qty_qc_posted > 0
           AND CASE WHEN c.reference_type = 'PO' THEN g.purchase_order_id = c.reference_id ELSE g.id = c.reference_id END
      ),
      done AS (
        SELECT a.grn_item_id, a.grn_id, a.raw_material_id, sum(a.amount) AS amount,
               (array_agg(a.inventory_id ORDER BY a.created_at DESC))[1] AS inventory_id
          FROM inventory.landed_cost_allocations a
         WHERE a.cost_id = c.id
         GROUP BY a.grn_item_id, a.grn_id, a.raw_material_id
      )
      SELECT COALESCE(ln.grn_item_id, d.grn_item_id) AS grn_item_id,
             COALESCE(ln.grn_id, d.grn_id) AS grn_id,
             COALESCE(ln.raw_material_id, d.raw_material_id) AS raw_material_id,
             CASE WHEN ln.movement_id IS NOT NULL AND v_basis > 0
                  THEN round(v_amount * ln.value / v_basis, 2) ELSE 0 END AS target,
             COALESCE(d.amount, 0) AS done,
             COALESCE(mv.inventory_id, d.inventory_id) AS inventory_id,
             ln.movement_id
        FROM lines ln
        FULL JOIN done d ON d.grn_item_id = ln.grn_item_id
        LEFT JOIN inventory.inventory_movements mv ON mv.id = ln.movement_id
       ORDER BY 1
    LOOP
      v_delta := l.target - l.done;
      CONTINUE WHEN abs(v_delta) < 0.005;
      v_cap := 0;
      v_exp := v_delta;
      IF l.inventory_id IS NOT NULL THEN
        SELECT i.id, i.qty_available, COALESCE(i.unit_cost, 0) AS unit_cost INTO v_inv
          FROM inventory.inventory i WHERE i.id = l.inventory_id FOR UPDATE;
        IF FOUND AND v_inv.qty_available > 0 THEN
          v_cap := GREATEST(v_delta, -(v_inv.qty_available * v_inv.unit_cost));
          v_exp := v_delta - v_cap;
          UPDATE inventory.inventory
             SET unit_cost = (v_inv.qty_available * v_inv.unit_cost + v_cap) / v_inv.qty_available,
                 updated_by = COALESCE(p_user_id, updated_by), updated_at = now()
           WHERE id = v_inv.id;
          IF l.movement_id IS NOT NULL THEN
            UPDATE inventory.stock_batches b
               SET unit_cost = GREATEST(0, b.unit_cost + v_cap / b.qty_received), updated_at = now()
             WHERE b.source_movement_id = l.movement_id AND b.qty_received > 0;
          END IF;
        END IF;
      END IF;
      INSERT INTO inventory.landed_cost_allocations
        (batch_id, cost_id, grn_id, grn_item_id, raw_material_id, inventory_id, amount, capitalized, expensed, created_by)
      VALUES (v_batch, c.id, l.grn_id, l.grn_item_id, l.raw_material_id, l.inventory_id, v_delta, v_cap, v_exp, p_user_id);
      v_cap_total := v_cap_total + v_cap;
      v_exp_total := v_exp_total + v_exp;
    END LOOP;

    IF v_cap_total <> 0 OR v_exp_total <> 0 THEN
      batch_id := v_batch;
      cost_id := c.id;
      company_id := v_company;
      capitalized := v_cap_total;
      expensed := v_exp_total;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

-- Journal mappings: PURCHASE_LANDED_COST and its reversal for the global
-- template and every company that maps PURCHASE_GRN, with the accounts that
-- company already uses for inventory (PURCHASE_GRN), AP (PURCHASE_AP_INVOICE)
-- and COGS (POS_COGS_RELIEF). Inventory and COGS lines are optional: a batch
-- may have only one of the two.
INSERT INTO accounting.journal_mappings (company_id, event_code, name, description, module, is_active)
SELECT src.company_id, v.event_code, v.name, v.description, 'PURCHASING', true
  FROM (SELECT DISTINCT m.company_id FROM accounting.journal_mappings m
         WHERE m.event_code = 'PURCHASE_GRN' AND m.deleted_at IS NULL) AS src
 CROSS JOIN (VALUES
   ('PURCHASE_LANDED_COST', 'Purchase Landed Cost',
    'Biaya tambahan pembelian (ongkir, bea, handling) dikapitalisasi ke inventory'),
   ('PURCHASE_LANDED_COST_REVERSAL', 'Purchase Landed Cost Reversal',
    'Pembalikan biaya tambahan pembelian yang dihapus dari inventory')
 ) AS v(event_code, name, description)
 WHERE NOT EXISTS (
   SELECT 1 FROM accounting.journal_mappings m
    WHERE m.event_code = v.event_code
      AND m.company_id IS NOT DISTINCT FROM src.company_id
      AND m.deleted_at IS NULL);

INSERT INTO accounting.journal_mapping_lines (mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required)
SELECT m.id, v.entry_side, v.line_role,
       (SELECT l.account_id
          FROM accounting.journal_mappings sm
          JOIN accounting.journal_mapping_lines l ON l.mapping_id = sm.id
         WHERE sm.event_code = v.source_event AND sm.deleted_at IS NULL
           AND sm.company_id IS NOT DISTINCT FROM m.company_id
           AND l.line_role = v.line_role AND l.account_id IS NOT NULL
         ORDER BY l.sort_order LIMIT 1),
       v.amount_source, v.sort_order, v.is_required
  FROM accounting.journal_mappings m
  JOIN (VALUES
    ('PURCHASE_LANDED_COST', 'DEBIT', 'INVENTORY', 'SUBTOTAL', 10, false, 'PURCHASE_GRN'),
    ('PURCHASE_LANDED_COST', 'DEBIT', 'COGS', 'COGS', 20, false, 'POS_COGS_RELIEF'),
    ('PURCHASE_LANDED_COST', 'CREDIT', 'AP', 'TOTAL', 30, true, 'PURCHASE_AP_INVOICE'),
    ('PURCHASE_LANDED_COST_REVERSAL', 'DEBIT', 'AP', 'TOTAL', 10, true, 'PURCHASE_AP_INVOICE'),
    ('PURCHASE_LANDED_COST_REVERSAL', 'CREDIT', 'INVENTORY', 'SUBTOTAL', 20, false, 'PURCHASE_GRN'),
    ('PURCHASE_LANDED_COST_REVERSAL', 'CREDIT', 'COGS', 'COGS', 30, false, 'POS_COGS_RELIEF')
  ) AS v(event_code, entry_side, line_role, amount_source, sort_order, is_required, source_event)
    ON v.event_code = m.event_code
 WHERE m.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM accounting.journal_mapping_lines l WHERE l.mapping_id = m.id);
