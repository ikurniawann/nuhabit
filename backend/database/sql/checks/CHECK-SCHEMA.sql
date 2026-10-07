-- ============================================
-- Check Actual Column Names in gr_items Table
-- Run this FIRST to get correct schema
-- ============================================

-- Get all columns from gr_items
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'gr_items'
ORDER BY ordinal_position;

-- Alternative: Check goods_receipt_items if that's the actual table name
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'goods_receipt_items'
ORDER BY ordinal_position;

-- Check what tables exist related to GRN
SELECT table_name
FROM information_schema.tables
WHERE table_name ILIKE '%gr%' 
   OR table_name ILIKE '%goods_receipt%'
   OR table_name ILIKE '%receipt_item%';
