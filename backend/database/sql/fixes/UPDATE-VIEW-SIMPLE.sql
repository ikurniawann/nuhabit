-- ============================================
-- Simple v_inventory update - No units join
-- Just add 'Pcs' as default satuan
-- ============================================

-- Drop and recreate view (simpler than ALTER VIEW)
DROP VIEW IF EXISTS v_inventory CASCADE;

CREATE VIEW v_inventory AS
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
  'Pcs' as satuan,  -- ← Hardcoded default unit
  inv.is_active,
  inv.created_at,
  inv.updated_at
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
WHERE inv.is_active = true;

-- Grant permissions
GRANT SELECT ON v_inventory TO authenticated;

-- Verify
SELECT material_nama, qty_available, satuan
FROM v_inventory
LIMIT 5;
