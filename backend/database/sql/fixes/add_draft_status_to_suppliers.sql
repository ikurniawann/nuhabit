-- Add 'draft' status to supplier_status_check constraint
-- Run this in psql atau SQL client

-- Drop existing constraint
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS supplier_status_check;

-- Add new constraint with 'draft' status
ALTER TABLE suppliers 
ADD CONSTRAINT supplier_status_check 
CHECK (status IN ('active', 'inactive', 'probation', 'blocked', 'draft'));

-- Verify constraint
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conname = 'supplier_status_check';
