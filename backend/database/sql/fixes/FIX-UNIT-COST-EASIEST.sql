-- ============================================
-- EASIEST FIX: Just set some test values manually
-- Then we can debug the schema properly
-- ============================================

-- Step 1: Check what columns gr_items actually has
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'gr_items'
ORDER BY ordinal_position;

-- Step 2: Manual update for testing (set known prices)
UPDATE inventory inv
SET unit_cost = CASE 
  WHEN inv.raw_material_id = (SELECT id FROM raw_materials WHERE nama ILIKE '%mie instant%' LIMIT 1) THEN 25000
  WHEN inv.raw_material_id = (SELECT id FROM raw_materials WHERE nama ILIKE '%gula merah%' LIMIT 1) THEN 8000
  WHEN inv.raw_material_id = (SELECT id FROM raw_materials WHERE nama ILIKE '%cokelat%' LIMIT 1) THEN 15000
  WHEN inv.raw_material_id = (SELECT id FROM raw_materials WHERE nama ILIKE '%tepung%' LIMIT 1) THEN 12000
  ELSE inv.unit_cost
END;

-- Step 3: Verify manual update worked
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available as stock,
  inv.unit_cost as "Unit Price",
  (inv.qty_available * inv.unit_cost) as "Total Value"
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
ORDER BY "Total Value" DESC
LIMIT 10;

-- Step 4: Check v_inventory view
SELECT 
  material_nama,
  qty_available,
  unit_cost,
  total_value as "Inventory Value"
FROM v_inventory
WHERE qty_available > 0
ORDER BY "Inventory Value" DESC;
