-- ============================================
-- FINAL FIX: Calculate Mie Instant Stock
-- Correct JOIN path through pr_items
-- ============================================

-- Step 1: Check total received for Mie Instant
-- Path: goods_receipts → gr_items → po_items → pr_items → raw_materials
SELECT 
  rm.id as raw_material_id,
  rm.nama,
  SUM(gri.qty_diterima) as total_received,
  SUM(gri.qty_ditolak) as total_rejected,
  COUNT(DISTINCT gr.id) as grn_count
FROM goods_receipts gr
JOIN gr_items gri ON gri.gr_id = gr.id
JOIN po_items poi ON poi.id = gri.po_item_id
JOIN pr_items pri ON pri.id = poi.pr_item_id  -- ← Link to pr_items
JOIN raw_materials rm ON rm.id = pri.raw_material_id  -- ← Finally to raw_materials
WHERE rm.nama ILIKE '%mie instant%'
GROUP BY rm.id, rm.nama;

-- Step 2: Check current inventory status
SELECT 
  inv.id,
  inv.raw_material_id,
  rm.nama,
  inv.qty_available,
  inv.last_movement_at
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
WHERE rm.nama ILIKE '%mie instant%';

-- Step 3: Update inventory based on actual GRN data
INSERT INTO inventory (
  raw_material_id,
  qty_available,
  unit_cost,
  last_movement_at,
  created_by,
  is_active
)
SELECT 
  rm.id as raw_material_id,
  SUM(gri.qty_diterima) as total_stock,
  AVG(poi.unit_price) as avg_cost,
  MAX(gr.created_at) as last_grn_date,
  (SELECT id FROM auth.users WHERE email ILIKE '%admin%' LIMIT 1) as admin_user,
  true
FROM goods_receipts gr
JOIN gr_items gri ON gri.gr_id = gr.id
JOIN po_items poi ON poi.id = gri.po_item_id
JOIN pr_items pri ON pri.id = poi.pr_item_id
JOIN raw_materials rm ON rm.id = pri.raw_material_id
WHERE rm.nama ILIKE '%mie instant%'
GROUP BY rm.id
ON CONFLICT (raw_material_id) DO UPDATE SET
  qty_available = EXCLUDED.qty_available,
  unit_cost = COALESCE(EXCLUDED.unit_cost, inventory.unit_cost),
  last_movement_at = NOW(),
  updated_by = (SELECT id FROM auth.users WHERE email ILIKE '%admin%' LIMIT 1);

-- Step 4: Verify the fix
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available as "Stock After Fix",
  inv.unit_cost as "Avg Cost",
  CASE 
    WHEN inv.qty_available = 0 THEN '❌ HABIS'
    WHEN inv.qty_available <= 10 THEN '⚠️ MENIPIS'
    ELSE '✅ AMAN'
  END as status
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
WHERE rm.nama ILIKE '%mie instant%';

-- Step 5: BONUS - Show ALL materials with stock from GRN
SELECT 
  rm.kode,
  rm.nama,
  COALESCE(SUM(gri.qty_diterima), 0) as "Total Received",
  COALESCE(inv.qty_available, 0) as "Current Stock",
  CASE 
    WHEN inv.qty_available IS NULL THEN 'Not in inventory'
    WHEN inv.qty_available = 0 THEN '❌ HABIS'
    WHEN inv.qty_available <= 10 THEN '⚠️ MENIPIS'
    ELSE '✅ OK'
  END as status
FROM raw_materials rm
LEFT JOIN pr_items pri ON pri.raw_material_id = rm.id
LEFT JOIN po_items poi ON poi.pr_item_id = pri.id
LEFT JOIN gr_items gri ON gri.po_item_id = poi.id
LEFT JOIN inventory inv ON inv.raw_material_id = rm.id
GROUP BY rm.kode, rm.nama, inv.qty_available
ORDER BY inv.qty_available ASC NULLS FIRST;
