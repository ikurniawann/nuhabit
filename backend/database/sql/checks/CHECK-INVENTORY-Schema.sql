-- ============================================
-- Check Inventory Table Schema
-- Run this in psql atau SQL client
-- ============================================

-- 1. Check table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'inventory'
ORDER BY ordinal_position;

-- 2. Check if raw_material_id or bahan_baku_id exists
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'inventory' 
  AND column_name IN ('raw_material_id', 'bahan_baku_id');

-- 3. Check current inventory data
SELECT 
  id,
  raw_material_id,
  bahan_baku_id,
  qty_available,
  qty_in_stock,
  unit_cost,
  avg_cost,
  last_movement_at
FROM inventory
LIMIT 5;

-- 4. Check recent GRN and expected inventory updates
SELECT 
  gr.nomor_grn,
  gri.raw_material_id,
  gri.qty_diterima,
  inv.qty_available as current_stock,
  inv.raw_material_id as inv_material_id
FROM goods_receipts gr
JOIN gr_items gri ON gri.grn_id = gr.id
LEFT JOIN inventory inv ON inv.raw_material_id = gri.raw_material_id
WHERE gr.created_at > NOW() - INTERVAL '1 hour'
ORDER BY gr.created_at DESC;
