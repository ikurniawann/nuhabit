-- ============================================
-- MANUAL FIX: Update receive_count for existing GRNs
-- Run this in psql atau SQL client
-- Date: 2026-04-23
-- ============================================

-- Step 1: Update receive_count based on delivery_id sequence
WITH ranked_grns AS (
  SELECT 
    id,
    delivery_id,
    ROW_NUMBER() OVER (
      PARTITION BY delivery_id 
      ORDER BY created_at ASC, id ASC
    ) as rn
  FROM grn
  WHERE is_active = TRUE
    AND status != 'rejected'
)
UPDATE grn
SET receive_count = ranked_grns.rn
FROM ranked_grns
WHERE grn.id = ranked_grns.id;

-- Step 2: Verify the fix
SELECT 
  nomor_grn,
  delivery_id,
  receive_count,
  status,
  created_at
FROM grn
WHERE is_active = TRUE
ORDER BY delivery_id, receive_count;

-- Step 3: Check if any duplicates or issues
SELECT 
  delivery_id,
  COUNT(*) as grn_count,
  MAX(receive_count) as highest_receive_count,
  STRING_AGG(nomor_grn || ' (#' || receive_count::text || ')', ', ' ORDER BY receive_count) as grns
FROM grn
WHERE is_active = TRUE
GROUP BY delivery_id
HAVING COUNT(*) > 1
ORDER BY delivery_id;
