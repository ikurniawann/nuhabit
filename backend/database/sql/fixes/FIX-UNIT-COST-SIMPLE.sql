-- ============================================
-- SIMPLE FINAL FIX: Use only unit_price
-- po_items hanya punya unit_price, tidak ada harga_satuan
-- ============================================

-- Update unit_cost dari GRN items
UPDATE inventory inv
SET unit_cost = COALESCE((
  SELECT AVG(poi.unit_price)
  FROM gr_items gri
  JOIN goods_receipts gr ON gr.id = gri.gr_id
  JOIN po_items poi ON poi.id = gri.po_item_id
  WHERE gri.raw_material_id = inv.raw_material_id
    AND gr.status IN ('received', 'partially_received')
    AND poi.unit_price > 0
), 0);

-- Verify the fix
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available as stock,
  inv.unit_cost as "Unit Price",
  (inv.qty_available * inv.unit_cost) as "Total Value",
  CASE 
    WHEN inv.unit_cost = 0 AND inv.qty_available > 0 THEN '⚠️ No price'
    WHEN inv.qty_available = 0 THEN 'ℹ️ No stock'
    ELSE '✅ OK'
  END as status
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
ORDER BY "Total Value" DESC NULLS LAST;

-- Check v_inventory view
SELECT 
  material_kode,
  material_nama,
  qty_available,
  unit_cost,
  total_value as "Inventory Value",
  satuan,
  stock_status
FROM v_inventory
WHERE qty_available > 0
ORDER BY total_value DESC;

-- Summary
SELECT 
  COUNT(*) as total_items,
  SUM(total_value) as "Total Inventory Value",
  COUNT(*) FILTER (WHERE total_value > 0) as "Items with value",
  COUNT(*) FILTER (WHERE total_value = 0 AND qty_available > 0) as "Missing price"
FROM v_inventory;
