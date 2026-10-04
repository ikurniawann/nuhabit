-- ============================================
-- FIX: Calculate & Update Mie Instant Stock
-- Run in psql atau SQL client
-- ============================================

-- Step 1: Check total received for Mie Instant from all GRNs
-- Use gr_id instead of grn_id
SELECT 
  poi.raw_material_id,
  rm.nama,
  SUM(gri.qty_diterima) as total_received,
  SUM(gri.qty_ditolak) as total_rejected
FROM goods_receipts gr
JOIN gr_items gri ON gri.gr_id = gr.id  -- Fixed: use gr_id
JOIN po_items poi ON poi.id = gri.po_item_id
JOIN raw_materials rm ON rm.id = poi.raw_material_id
WHERE poi.raw_material_id = '6ad2009e-3b7a-487d-8f51-a4f21d119bf3'  -- Mie Instant
GROUP BY poi.raw_material_id, rm.nama;

-- Step 2: Check current inventory
SELECT 
  inv.id,
  inv.raw_material_id,
  rm.nama,
  inv.qty_available,
  inv.last_movement_at
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
WHERE inv.raw_material_id = '6ad2009e-3b7a-487d-8f51-a4f21d119bf3';

-- Step 3: Update inventory to match actual GRN data
-- This calculates the correct stock from all GRNs and updates inventory
INSERT INTO inventory (
  raw_material_id,
  qty_available,
  unit_cost,
  last_movement_at,
  created_by,
  is_active
)
SELECT 
  poi.raw_material_id,
  SUM(gri.qty_diterima) as total_stock,
  AVG(poi.harga_satuan) as avg_cost,
  MAX(gr.created_at) as last_grn_date,
  (SELECT id FROM auth.users LIMIT 1) as admin_user,
  true
FROM goods_receipts gr
JOIN gr_items gri ON gri.gr_id = gr.id
JOIN po_items poi ON poi.id = gri.po_item_id
WHERE poi.raw_material_id = '6ad2009e-3b7a-487d-8f51-a4f21d119bf3'
GROUP BY poi.raw_material_id
ON CONFLICT (raw_material_id) DO UPDATE SET
  qty_available = EXCLUDED.qty_available,
  unit_cost = EXCLUDED.unit_cost,
  last_movement_at = NOW(),
  updated_by = (SELECT id FROM auth.users LIMIT 1);

-- Step 4: Verify the fix
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available as "Stock After Fix",
  inv.unit_cost,
  inv.last_movement_at
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
WHERE rm.nama ILIKE '%mie instant%';

-- Step 5: Check all inventory with their GRN history
SELECT 
  rm.kode,
  rm.nama,
  COALESCE(SUM(gri.qty_diterima), 0) as "Total Received (GRN)",
  COALESCE(inv.qty_available, 0) as "Current Stock",
  CASE 
    WHEN inv.qty_available IS NULL THEN '❌ Missing in inventory'
    WHEN inv.qty_available = 0 THEN '❌ HABIS'
    WHEN inv.qty_available <= COALESCE(inv.qty_minimum, 10) THEN '⚠️ MENIPIS'
    ELSE '✅ AMAN'
  END as status
FROM raw_materials rm
LEFT JOIN po_items poi ON poi.raw_material_id = rm.id
LEFT JOIN gr_items gri ON gri.po_item_id = poi.id
LEFT JOIN inventory inv ON inv.raw_material_id = rm.id
GROUP BY rm.kode, rm.nama, inv.qty_available, inv.qty_minimum
ORDER BY inv.qty_available ASC NULLS FIRST;
