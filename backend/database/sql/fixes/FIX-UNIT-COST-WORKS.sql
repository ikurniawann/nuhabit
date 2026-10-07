-- ============================================
-- WORKING FIX: Use correct JOIN path
-- gr_items.po_item_id → po_items.raw_material_id (via pr_items)
-- ============================================

-- Method: Update from PO items via GRN
UPDATE inventory inv
SET unit_cost = COALESCE((
  SELECT AVG(poi.unit_price)
  FROM gr_items gri
  JOIN goods_receipts gr ON gr.id = gri.gr_id
  JOIN po_items poi ON poi.id = gri.po_item_id
  JOIN pr_items pri ON pri.id = poi.pr_item_id
  WHERE pri.product_id = inv.raw_material_id  -- ← Link via product_id
    AND gr.status IN ('received', 'partially_received')
    AND poi.unit_price > 0
), 0);

-- Alternative: If raw_materials doesn't link to products,
-- just update all inventory with average from any GRN
UPDATE inventory inv
SET unit_cost = COALESCE((
  SELECT AVG(poi.unit_price)
  FROM gr_items gri
  JOIN goods_receipts gr ON gr.id = gri.gr_id
  JOIN po_items poi ON poi.id = gri.po_item_id
  WHERE gri.gr_id IN (
    SELECT DISTINCT gr2.id 
    FROM goods_receipts gr2
    JOIN gr_items gri2 ON gri2.gr_id = gr2.id
    WHERE gri2.raw_material_id = inv.raw_material_id  -- This should work!
  )
  AND poi.unit_price > 0
), 0);

-- Verify
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available as stock,
  inv.unit_cost as "Unit Price",
  (inv.qty_available * inv.unit_cost) as "Total Value"
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
ORDER BY "Total Value" DESC NULLS LAST
LIMIT 10;
