-- ============================================
-- Fix v_inventory with proper units join
-- Use satuan_besar_id from raw_materials
-- ============================================

-- Drop old view
DROP VIEW IF EXISTS v_inventory CASCADE;

-- Create new view with units join
CREATE VIEW v_inventory AS
SELECT 
  inv.id,
  inv.raw_material_id,
  rm.kode as material_kode,
  rm.nama as material_nama,
  rm.kategori as material_kategori,
  inv.qty_available,
  COALESCE(inv.qty_minimum, 1000) as qty_minimum,
  rm.stok_minimum as material_stok_minimum,
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
  u_besar.nama as satuan,        -- ← Satuan besar (Box, Kg, Liter)
  u_besar.kode as satuan_kode,
  u_kecil.nama as satuan_kecil,  -- ← Satuan kecil (Pcs, Gram, ml)
  rm.konversi_factor,
  inv.is_active,
  inv.created_at,
  inv.updated_at
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
LEFT JOIN units u_besar ON u_besar.id = rm.satuan_besar_id  -- ← Join satuan besar
LEFT JOIN units u_kecil ON u_kecil.id = rm.satuan_kecil_id  -- ← Join satuan kecil
WHERE inv.is_active = true;

-- Grant permissions
GRANT SELECT ON v_inventory TO authenticated;

-- Verify - show materials with their units
SELECT 
  rm.kode,
  rm.nama,
  u_besar.nama as satuan_besar,
  u_kecil.nama as satuan_kecil,
  rm.konversi_factor
FROM raw_materials rm
LEFT JOIN units u_besar ON u_besar.id = rm.satuan_besar_id
LEFT JOIN units u_kecil ON u_kecil.id = rm.satuan_kecil_id
LIMIT 10;

-- Test inventory view
SELECT 
  material_kode,
  material_nama,
  qty_available,
  satuan,
  stock_status
FROM v_inventory
LIMIT 10;
