-- ============================================
-- Debug: Check qty_minimum and qty_maximum values
-- ============================================

-- Step 1: Check inventory table directly
SELECT 
  inv.id,
  rm.kode,
  rm.nama,
  inv.qty_available,
  inv.qty_minimum,
  inv.qty_maximum,
  rm.stok_minimum as material_stok_minimum,
  CASE 
    WHEN inv.qty_minimum IS NULL THEN '❌ NULL'
    WHEN inv.qty_minimum = 0 THEN '⚠️ ZERO'
    ELSE '✅ OK'
  END as min_status,
  CASE 
    WHEN inv.qty_maximum IS NULL THEN '❌ NULL'
    WHEN inv.qty_maximum = 0 THEN '⚠️ ZERO'
    ELSE '✅ OK'
  END as max_status
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
ORDER BY inv.qty_minimum ASC NULLS FIRST
LIMIT 10;

-- Step 2: Check v_inventory view output
SELECT 
  material_kode,
  material_nama,
  qty_available,
  qty_minimum,
  qty_maximum,
  material_stok_minimum,
  satuan,
  stock_status
FROM v_inventory
LIMIT 10;

-- Step 3: Fix NULL/ZERO values
-- Update inventory to use default minimum 1000 if NULL or 0
UPDATE inventory
SET 
  qty_minimum = 1000,
  qty_maximum = COALESCE(qty_maximum, 10000)
WHERE 
  qty_minimum IS NULL 
  OR qty_minimum = 0
  OR qty_maximum IS NULL;

-- Step 4: Verify fix
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available,
  inv.qty_minimum as "Fixed Minimum",
  inv.qty_maximum as "Fixed Maximum"
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
ORDER BY inv.created_at DESC
LIMIT 10;

-- Step 5: Check view after fix
SELECT 
  material_nama,
  qty_available,
  qty_minimum,
  qty_maximum,
  stock_status
FROM v_inventory
WHERE qty_minimum <= 1000 OR qty_available <= qty_minimum
ORDER BY qty_available ASC
LIMIT 10;
