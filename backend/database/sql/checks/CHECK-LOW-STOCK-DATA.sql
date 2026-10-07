-- ============================================
-- Check why no low stock items showing
-- ============================================

-- Step 1: Check all inventory items with their min/max
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available as current_stock,
  inv.qty_minimum as minimum_stock,
  inv.qty_maximum as maximum_stock,
  CASE 
    WHEN inv.qty_available <= 0 THEN '❌ OUT OF STOCK'
    WHEN inv.qty_available < inv.qty_minimum THEN '⚠️ LOW STOCK'
    ELSE '✅ OK'
  END as status,
  (inv.qty_minimum - inv.qty_available) as shortage
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
ORDER BY inv.qty_available ASC;

-- Step 2: Check v_inventory view output
SELECT 
  material_kode,
  material_nama,
  qty_available,
  qty_minimum,
  stock_status,
  satuan
FROM v_inventory
WHERE qty_available <= qty_minimum
ORDER BY qty_available ASC;

-- Step 3: Force test - temporarily set high minimum for testing
UPDATE inventory 
SET qty_minimum = 1000 
WHERE raw_material_id IN (
  SELECT id FROM raw_materials 
  WHERE nama ILIKE '%mie instant%' OR nama ILIKE '%gula%'
);

-- Check if they appear now
SELECT 
  rm.nama,
  inv.qty_available,
  inv.qty_minimum,
  (inv.qty_minimum - inv.qty_available) as shortage
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
WHERE inv.qty_available < inv.qty_minimum;

-- Rollback test (optional - comment out if you want to keep changes)
UPDATE inventory 
SET qty_minimum = 1 
WHERE raw_material_id IN (
  SELECT id FROM raw_materials 
  WHERE nama ILIKE '%mie instant%' OR nama ILIKE '%gula%'
);
