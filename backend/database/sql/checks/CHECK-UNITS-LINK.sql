-- ============================================
-- Check if raw_materials has unit/satuan link
-- ============================================

-- Step 1: Check all columns in raw_materials
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'raw_materials'
ORDER BY ordinal_position;

-- Step 2: Check if there's any unit-related column
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'raw_materials'
  AND (column_name ILIKE '%satuan%' 
       OR column_name ILIKE '%unit%' 
       OR column_name ILIKE '%uom%');

-- Step 3: Check units table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'units'
ORDER BY ordinal_position;

-- Step 4: Sample data from raw_materials to see what unit info exists
SELECT 
  id,
  kode,
  nama,
  kategori
  -- Add other columns if they exist
FROM raw_materials
LIMIT 5;
