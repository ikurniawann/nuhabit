-- Check current status
SELECT 
  COUNT(*) FILTER (WHERE is_active = true) as active_count,
  COUNT(*) FILTER (WHERE is_active = false) as inactive_count,
  COUNT(*) as total
FROM positions;

-- Update all positions to active
UPDATE positions 
SET is_active = true 
WHERE is_active = false;

-- Verify the update
SELECT 
  COUNT(*) FILTER (WHERE is_active = true) as active_count,
  COUNT(*) FILTER (WHERE is_active = false) as inactive_count,
  COUNT(*) as total
FROM positions;

-- Show all active positions
SELECT id, title, brand_id, is_active 
FROM positions 
ORDER BY title;
