-- ============================================
-- Fix v_inventory: Ensure qty_minimum and qty_maximum are correct
-- Priority: inventory table > raw_materials default > hardcoded default
-- ============================================

-- Drop old view
DROP VIEW IF EXISTS v_inventory CASCADE;

-- Create corrected view
CREATE VIEW v_inventory AS
SELECT 
  inv.id,
  inv.raw_material_id,
  rm.kode as material_kode,
  rm.nama as material_nama,
  rm.kategori as material_kategori,
  
  -- Stock quantities - use inventory values
  inv.qty_available,
  
  -- Minimum stock: priority = inventory > raw_materials > default 1000
  COALESCE(inv.qty_minimum, rm.stok_minimum, 1000) as qty_minimum,
  
  -- Maximum stock: priority = inventory > default 10000
  COALESCE(inv.qty_maximum, 10000) as qty_maximum,
  
  -- Cost and value
  inv.unit_cost,
  (inv.qty_available * inv.unit_cost) as total_value,
  
  -- Stock status calculation
  CASE 
    WHEN inv.qty_available <= 0 THEN 'out_of_stock'
    WHEN inv.qty_available <= COALESCE(inv.qty_minimum, rm.stok_minimum, 1000) THEN 'low_stock'
    WHEN inv.qty_available >= COALESCE(inv.qty_maximum, 10000) THEN 'overstock'
    ELSE 'normal'
  END as stock_status,
  
  -- Metadata
  inv.last_movement_at,
  inv.lokasi_rak,
  
  -- Units
  u_besar.nama as satuan,
  u_besar.kode as satuan_kode,
  u_kecil.nama as satuan_kecil,
  rm.konversi_factor,
  
  -- Audit
  inv.is_active,
  inv.created_at,
  inv.updated_at
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
LEFT JOIN units u_besar ON u_besar.id = rm.satuan_besar_id
LEFT JOIN units u_kecil ON u_kecil.id = rm.satuan_kecil_id
WHERE inv.is_active = true;

-- Grant permissions
GRANT SELECT ON v_inventory TO authenticated;

-- Test the view
SELECT 
  material_kode,
  material_nama,
  qty_available,
  qty_minimum,
  qty_maximum,
  satuan,
  stock_status,
  total_value
FROM v_inventory
ORDER BY qty_available ASC
LIMIT 15;

-- Summary statistics
SELECT 
  COUNT(*) as total_items,
  COUNT(*) FILTER (WHERE qty_available <= 0) as out_of_stock,
  COUNT(*) FILTER (WHERE qty_available > 0 AND qty_available <= qty_minimum) as low_stock,
  COUNT(*) FILTER (WHERE qty_available > qty_minimum AND qty_available < qty_maximum) as normal_stock,
  COUNT(*) FILTER (WHERE qty_available >= qty_maximum) as overstock,
  AVG(qty_minimum) as avg_minimum,
  AVG(qty_maximum) as avg_maximum,
  SUM(total_value) as total_inventory_value
FROM v_inventory;
