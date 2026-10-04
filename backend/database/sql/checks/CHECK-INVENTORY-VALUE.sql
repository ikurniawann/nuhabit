-- ============================================
-- Debug: Check why inventory value is 0
-- ============================================

-- Step 1: Check inventory table directly
SELECT 
  inv.id,
  rm.kode,
  rm.nama,
  inv.qty_available,
  inv.unit_cost,
  (inv.qty_available * inv.unit_cost) as calculated_value,
  CASE 
    WHEN inv.unit_cost IS NULL THEN '❌ unit_cost NULL'
    WHEN inv.unit_cost = 0 THEN '❌ unit_cost = 0'
    WHEN inv.qty_available = 0 THEN '⚠️ qty = 0 (no stock)'
    ELSE '✅ OK'
  END as issue
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
ORDER BY inv.qty_available DESC
LIMIT 10;

-- Step 2: Check v_inventory view output
SELECT 
  material_kode,
  material_nama,
  qty_available,
  unit_cost,
  total_value,
  CASE 
    WHEN total_value = 0 AND qty_available > 0 THEN '❌ Bug: has stock but no value'
    WHEN total_value = 0 AND qty_available = 0 THEN '✅ Correct: no stock = no value'
    ELSE '✅ OK'
  END as status
FROM v_inventory
LIMIT 10;

-- Step 3: Check PO items for unit prices
-- See if we can get unit_cost from PO history
SELECT 
  rm.kode,
  rm.nama,
  poi.unit_price as po_unit_price,
  poi.qty_ordered,
  po.po_number,
  po.status as po_status
FROM raw_materials rm
LEFT JOIN pr_items pri ON pri.raw_material_id = rm.id
LEFT JOIN po_items poi ON poi.pr_item_id = pri.id
LEFT JOIN purchase_orders po ON po.id = poi.purchase_order_id
WHERE rm.nama IN ('Mie Instant', 'Gula Merah', 'Cokelat Batang')
ORDER BY po.created_at DESC
LIMIT 10;

-- Step 4: Fix - Update inventory unit_cost from latest PO
UPDATE inventory inv
SET unit_cost = (
  SELECT COALESCE(AVG(poi.unit_price), 0)
  FROM raw_materials rm
  LEFT JOIN pr_items pri ON pri.raw_material_id = rm.id
  LEFT JOIN po_items poi ON poi.pr_item_id = pri.id
  LEFT JOIN purchase_orders po ON po.id = poi.purchase_order_id
  WHERE rm.id = inv.raw_material_id
    AND po.status = 'received'
    AND poi.unit_price > 0
  GROUP BY rm.id
)
WHERE inv.unit_cost = 0 OR inv.unit_cost IS NULL;

-- Step 5: Verify fix
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available,
  inv.unit_cost,
  (inv.qty_available * inv.unit_cost) as total_value
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
ORDER BY total_value DESC
LIMIT 10;
