-- ============================================
-- Update v_inventory view to include satuan
-- Run in psql atau SQL client
-- ============================================

-- Step 1: Check current v_inventory view definition
SELECT definition 
FROM pg_views 
WHERE viewname = 'v_inventory';

-- Step 2: Drop and recreate view with satuan column
-- First, check what columns raw_materials has for satuan
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'raw_materials'
  AND column_name IN ('satuan_id', 'satuan', 'unit_id', 'unit');

-- Step 3: Check units table structure
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'units'
ORDER BY ordinal_position;

-- Step 4: Recreate v_inventory view with satuan
CREATE OR REPLACE VIEW v_inventory AS
SELECT 
  inv.id,
  inv.raw_material_id,
  rm.kode as material_kode,
  rm.nama as material_nama,
  rm.kategori as material_kategori,
  inv.qty_available,
  COALESCE(inv.qty_minimum, 1000) as qty_minimum,
  inv.qty_maximum,
  inv.unit_cost,
  (inv.qty_available * inv.unit_cost) as total_value,
  CASE 
    WHEN inv.qty_available <= 0 THEN 'out_of_stock'
    WHEN inv.qty_available <= COALESCE(inv.qty_minimum, 1000) THEN 'low_stock'
    WHEN inv.qty_available >= COALESCE(inv.qty_maximum, 10000) THEN 'overstock'
    ELSE 'normal'
  END as stock_status,
  inv.last_movement_at,
  inv.lokasi_rak,
  u.nama as satuan,  -- ← Add satuan from units table
  u.kode as satuan_kode,
  inv.is_active,
  inv.created_at,
  inv.updated_at
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
LEFT JOIN units u ON u.id = rm.satuan_id  -- ← Join to units table
WHERE inv.is_active = true;

-- Step 5: Verify the view
SELECT 
  material_kode,
  material_nama,
  qty_available,
  qty_minimum,
  satuan,
  stock_status
FROM v_inventory
LIMIT 10;

-- Step 6: Grant permissions
GRANT SELECT ON v_inventory TO authenticated;
