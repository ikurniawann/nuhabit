-- ============================================
-- FINAL FIX: Use product_id instead of raw_material_id
-- Products table is the link!
-- ============================================

-- Step 1: Check if products has raw_material_id or bahan_baku_id
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'products'
ORDER BY ordinal_position;

-- Step 2: Alternative - Check total received using product_id
SELECT 
  p.id as product_id,
  p.nama as product_name,
  SUM(gri.qty_diterima) as total_received,
  SUM(gri.qty_ditolak) as total_rejected,
  COUNT(DISTINCT gr.id) as grn_count
FROM goods_receipts gr
JOIN gr_items gri ON gri.gr_id = gr.id
JOIN po_items poi ON poi.id = gri.po_item_id
JOIN pr_items pri ON pri.id = poi.pr_item_id
JOIN products p ON p.id = pri.product_id
WHERE p.nama ILIKE '%mie instant%'
GROUP BY p.id, p.nama;

-- Step 3: Check inventory table schema - what ID does it use?
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'inventory'
ORDER BY ordinal_position;

-- Step 4: Update inventory using product_id (if inventory uses product_id)
INSERT INTO inventory (
  product_id,  -- Changed from raw_material_id
  qty_available,
  unit_cost,
  last_movement_at,
  created_by,
  is_active
)
SELECT 
  p.id as product_id,
  SUM(gri.qty_diterima) as total_stock,
  AVG(poi.unit_price) as avg_cost,
  MAX(gr.created_at) as last_grn_date,
  (SELECT id FROM auth.users LIMIT 1),
  true
FROM goods_receipts gr
JOIN gr_items gri ON gri.gr_id = gr.id
JOIN po_items poi ON poi.id = gri.po_item_id
JOIN pr_items pri ON pri.id = poi.pr_item_id
JOIN products p ON p.id = pri.product_id
WHERE p.nama ILIKE '%mie instant%'
GROUP BY p.id
ON CONFLICT (product_id) DO UPDATE SET
  qty_available = EXCLUDED.qty_available,
  last_movement_at = NOW();

-- Step 5: Verify
SELECT 
  p.kode,
  p.nama,
  inv.qty_available as "Stock After Fix"
FROM inventory inv
JOIN products p ON p.id = inv.product_id
WHERE p.nama ILIKE '%mie instant%';
