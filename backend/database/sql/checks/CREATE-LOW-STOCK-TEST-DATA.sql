-- ============================================
-- Create Test Data for Low Stock Report
-- Run this to populate low stock items for testing
-- ============================================

-- Step 1: Check current inventory status
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available as stock,
  inv.qty_minimum as current_min,
  CASE 
    WHEN inv.qty_available <= 0 THEN '❌ OUT'
    WHEN inv.qty_available < inv.qty_minimum THEN '⚠️ LOW'
    ELSE '✅ OK'
  END as status
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
ORDER BY inv.qty_available ASC;

-- Step 2: Update minimum stock to create low stock scenarios
UPDATE inventory 
SET qty_minimum = 
  CASE 
    WHEN raw_material_id = (SELECT id FROM raw_materials WHERE nama ILIKE '%mie instant%' LIMIT 1) THEN 1000
    WHEN raw_material_id = (SELECT id FROM raw_materials WHERE nama ILIKE '%gula%' LIMIT 1) THEN 500
    WHEN raw_material_id = (SELECT id FROM raw_materials WHERE nama ILIKE '%cokelat%' LIMIT 1) THEN 1500
    WHEN raw_material_id = (SELECT id FROM raw_materials WHERE nama ILIKE '%tepung%' LIMIT 1) THEN 800
    ELSE qty_minimum
  END
WHERE raw_material_id IN (
  SELECT id FROM raw_materials 
  WHERE nama ILIKE '%mie instant%' 
     OR nama ILIKE '%gula%'
     OR nama ILIKE '%cokelat%'
     OR nama ILIKE '%tepung%'
);

-- Step 3: Verify the update created low stock items
SELECT 
  material_kode,
  material_nama,
  qty_available as stock,
  qty_minimum as new_min,
  (qty_minimum - qty_available) as shortage,
  stock_status
FROM v_inventory
WHERE qty_available < qty_minimum
ORDER BY qty_available ASC;

-- Step 4: Check if view shows correct status
SELECT 
  material_nama,
  qty_available,
  qty_minimum,
  stock_status,
  satuan
FROM v_inventory
WHERE stock_status IN ('out_of_stock', 'low_stock')
ORDER BY qty_available ASC;

-- Step 5: Summary
SELECT 
  COUNT(*) as total_items,
  COUNT(*) FILTER (WHERE qty_available <= 0) as out_of_stock,
  COUNT(*) FILTER (WHERE qty_available > 0 AND qty_available < qty_minimum) as low_stock,
  COUNT(*) FILTER (WHERE qty_available >= qty_minimum) as adequate_stock
FROM v_inventory;
