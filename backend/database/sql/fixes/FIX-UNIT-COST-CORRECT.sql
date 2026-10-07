-- ============================================
-- FIX: Update unit_cost from PO history
-- Correct JOIN path through products
-- ============================================

-- Step 1: Check current unit_cost values
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available,
  inv.unit_cost,
  (inv.qty_available * inv.unit_cost) as total_value
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
ORDER BY inv.unit_cost ASC NULLS FIRST
LIMIT 10;

-- Step 2: Update unit_cost from received POs
-- Path: inventory → raw_materials → pr_items → po_items → purchase_orders
UPDATE inventory inv
SET unit_cost = COALESCE((
  SELECT AVG(COALESCE(poi.unit_price, poi.harga_satuan))
  FROM raw_materials rm
  INNER JOIN pr_items pri ON pri.product_id = rm.id  -- ← Fixed: join via product_id
  INNER JOIN po_items poi ON poi.pr_item_id = pri.id
  INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
  WHERE rm.id = inv.raw_material_id
    AND po.status IN ('received', 'partially_received')
    AND (poi.unit_price > 0 OR poi.harga_satuan > 0)
), 0);

-- Alternative: If raw_materials doesn't link to products directly,
-- use GRN items to find the price
UPDATE inventory inv
SET unit_cost = COALESCE((
  SELECT AVG(COALESCE(poi.unit_price, poi.harga_satuan))
  FROM gr_items gri
  INNER JOIN goods_receipts gr ON gr.id = gri.gr_id
  INNER JOIN po_items poi ON poi.id = gri.po_item_id
  INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
  WHERE gri.raw_material_id = inv.raw_material_id
    AND gr.status IN ('received', 'partially_received')
    AND (poi.unit_price > 0 OR poi.harga_satuan > 0)
), 0);

-- Step 3: Verify fix
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available as stock,
  inv.unit_cost as "Unit Price",
  (inv.qty_available * inv.unit_cost) as "Total Value",
  CASE 
    WHEN inv.unit_cost = 0 AND inv.qty_available > 0 THEN '❌ Missing price'
    ELSE '✅ OK'
  END as status
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
ORDER BY "Total Value" DESC
LIMIT 10;

-- Step 4: Check v_inventory view
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
