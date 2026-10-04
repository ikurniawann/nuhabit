-- ============================================
-- FIX: Check & Update Inventory for Mie Instant
-- Run in psql atau SQL client
-- ============================================

-- Step 1: Check GRN untuk Mie Instant
SELECT 
  gr.id as grn_id,
  gr.nomor_grn,
  gri.qty_diterima,
  gri.raw_material_id,
  rm.nama as material_name,
  gr.created_at
FROM goods_receipts gr
JOIN gr_items gri ON gri.gr_id = gr.id  -- Fixed: gr_id not grn_id
JOIN raw_materials rm ON rm.id = gri.raw_material_id
WHERE rm.nama ILIKE '%mie instant%'
ORDER BY gr.created_at DESC
LIMIT 5;

-- Step 2: Check Current Inventory Status
SELECT 
  inv.id,
  inv.raw_material_id,
  rm.nama as material_name,
  inv.qty_available,
  inv.unit_cost,
  inv.last_movement_at
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
WHERE rm.nama ILIKE '%mie instant%';

-- Step 3: Manual Fix - Add Stock for Mie Instant
-- Replace '6ad2009e-3b7a-487d-8f51-a4f21d119bf3' with actual raw_material_id if different
INSERT INTO inventory (
  raw_material_id, 
  qty_available, 
  unit_cost, 
  last_movement_at, 
  created_by,
  is_active
)
VALUES (
  '6ad2009e-3b7a-487d-8f51-a4f21d119bf3',  -- Mie Instant ID
  50,                                        -- Qty from GRN
  10000,                                     -- Average cost (adjust if needed)
  NOW(),
  '0bb9f24e-89f8-4476-8da0-374addf32948',   -- Admin user ID (adjust if needed)
  true
)
ON CONFLICT (raw_material_id) 
DO UPDATE SET 
  qty_available = inventory.qty_available + 50,
  last_movement_at = NOW(),
  updated_by = '0bb9f24e-89f8-4476-8da0-374addf32948';

-- Step 4: Verify Fix
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available as stock,
  inv.unit_cost,
  inv.last_movement_at
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
WHERE rm.nama ILIKE '%mie instant%';

-- Step 5: Optional - Check All Inventory with Zero Stock
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available,
  inv.last_movement_at,
  CASE 
    WHEN inv.qty_available = 0 THEN '❌ HABIS'
    WHEN inv.qty_available <= inv.qty_minimum THEN '⚠️ MENIPIS'
    ELSE '✅ AMAN'
  END as status
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
ORDER BY inv.qty_available ASC;
