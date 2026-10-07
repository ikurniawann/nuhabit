-- ============================================
-- FIX: Update inventory.unit_cost from PO history
-- ============================================

-- Step 1: Check current unit_cost values
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available,
  inv.unit_cost,
  (inv.qty_available * inv.unit_cost) as total_value,
  CASE 
    WHEN inv.unit_cost IS NULL THEN '❌ NULL'
    WHEN inv.unit_cost = 0 THEN '❌ ZERO'
    ELSE '✅ OK'
  END as cost_status
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
ORDER BY inv.unit_cost ASC NULLS FIRST
LIMIT 10;

-- Step 2: Check PO items for unit prices
SELECT 
  rm.kode,
  rm.nama,
  poi.unit_price,
  poi.harga_satuan,
  po.po_number,
  po.status
FROM raw_materials rm
LEFT JOIN pr_items pri ON pri.raw_material_id = rm.id
LEFT JOIN po_items poi ON poi.pr_item_id = pri.id
LEFT JOIN purchase_orders po ON po.id = poi.purchase_order_id
WHERE rm.nama IN ('Mie Instant', 'Gula Merah', 'Cokelat Batang')
  AND po.status = 'received'
  AND (poi.unit_price > 0 OR poi.harga_satuan > 0)
ORDER BY po.created_at DESC;

-- Step 3: Update unit_cost from latest received PO
-- Use weighted average from all received POs
UPDATE inventory inv
SET unit_cost = COALESCE((
  SELECT AVG(COALESCE(poi.unit_price, poi.harga_satuan))
  FROM raw_materials rm
  LEFT JOIN pr_items pri ON pri.raw_material_id = rm.id
  LEFT JOIN po_items poi ON poi.pr_item_id = pri.id
  LEFT JOIN purchase_orders po ON po.id = poi.purchase_order_id
  WHERE rm.id = inv.raw_material_id
    AND po.status IN ('received', 'partially_received')
    AND (poi.unit_price > 0 OR poi.harga_satuan > 0)
), 0);

-- Step 4: Verify fix
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available,
  inv.unit_cost as "New Unit Cost",
  (inv.qty_available * inv.unit_cost) as "Total Value",
  TO_CHAR(inv.last_movement_at, 'DD Mon YYYY') as "Last Update"
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
ORDER BY "Total Value" DESC
LIMIT 10;

-- Step 5: Check v_inventory view
SELECT 
  material_kode,
  material_nama,
  qty_available,
  unit_cost,
  total_value as "Inventory Value",
  satuan,
  stock_status
FROM v_inventory
ORDER BY total_value DESC
LIMIT 10;

-- Step 6: Summary by value
SELECT 
  COUNT(*) as total_items,
  SUM(total_value) as total_inventory_value,
  AVG(unit_cost) as avg_unit_cost,
  COUNT(*) FILTER (WHERE total_value = 0) as zero_value_items,
  COUNT(*) FILTER (WHERE unit_cost = 0) as zero_cost_items
FROM v_inventory;
