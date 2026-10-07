-- ============================================
-- FIX: Use raw_materials.stok_minimum as primary source
-- Only use 1000 as last resort fallback
-- ============================================

-- Drop old view
DROP VIEW IF EXISTS v_inventory CASCADE;

-- Create corrected view with proper priority
CREATE VIEW v_inventory AS
SELECT 
  inv.id,
  inv.raw_material_id,
  rm.kode as material_kode,
  rm.nama as material_nama,
  rm.kategori as material_kategori,
  inv.qty_available,
  
  -- CORRECT PRIORITY: raw_materials first, then inventory, then default
  COALESCE(rm.stok_minimum, inv.qty_minimum, 1000) as qty_minimum,
  
  -- Maximum: inventory > default 10000
  COALESCE(inv.qty_maximum, 10000) as qty_maximum,
  
  inv.unit_cost,
  (inv.qty_available * inv.unit_cost) as total_value,
  
  -- Status calculation using correct minimum
  CASE 
    WHEN inv.qty_available <= 0 THEN 'out_of_stock'
    WHEN inv.qty_available <= COALESCE(rm.stok_minimum, inv.qty_minimum, 1000) THEN 'low_stock'
    WHEN inv.qty_available >= COALESCE(inv.qty_maximum, 10000) THEN 'overstock'
    ELSE 'normal'
  END as stock_status,
  
  inv.last_movement_at,
  u_besar.nama as satuan,
  u_besar.kode as satuan_kode,
  inv.is_active,
  inv.created_at,
  inv.updated_at
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
LEFT JOIN units u_besar ON u_besar.id = rm.satuan_besar_id
WHERE inv.is_active = true;

-- Grant permissions
GRANT SELECT ON v_inventory TO authenticated;

-- Test - should show correct minimum from raw_materials
SELECT 
  material_kode,
  material_nama,
  qty_available as stock,
  qty_minimum as "Min (from RM)",
  rm.stok_minimum as "RM stok_minimum",
  satuan,
  stock_status as status
FROM v_inventory v
JOIN raw_materials rm ON rm.kode = v.material_kode
ORDER BY material_nama
LIMIT 10;

-- Verify all items have correct minimum
SELECT 
  material_nama,
  qty_available,
  qty_minimum,
  CASE 
    WHEN qty_minimum = 1000 AND qty_minimum != rm.stok_minimum THEN '⚠️ Using default 1000'
    WHEN qty_minimum = rm.stok_minimum THEN '✅ From raw_materials'
    WHEN qty_minimum = qty_minimum THEN '✅ From inventory table'
    ELSE '❓ Unknown'
  END as source_check
FROM v_inventory v
JOIN raw_materials rm ON rm.kode = v.material_kode
ORDER BY material_nama;
