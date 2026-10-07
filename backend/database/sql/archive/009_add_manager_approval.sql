-- =====================================================
-- MIGRATION 009: Add Manager Approval Fields
-- =====================================================
-- Menambahkan fields untuk manager approval workflow
-- Jalankan di admin database > SQL Editor
-- =====================================================

-- 1. Add new columns to feedback_assignments
ALTER TABLE feedback_assignments
ADD COLUMN IF NOT EXISTS manager_comments text,
ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES employees(id),
ADD COLUMN IF NOT EXISTS approved_at timestamptz,
ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 2. Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_feedback_assignments_approval 
ON feedback_assignments(approved_at, status);

-- 3. Add check constraint for status values
ALTER TABLE feedback_assignments
DROP CONSTRAINT IF EXISTS check_assignment_status;

ALTER TABLE feedback_assignments
ADD CONSTRAINT check_assignment_status 
CHECK (status IN ('pending', 'in_progress', 'submitted', 'approved', 'rejected'));

-- 4. Create trigger to auto-update summary status when approved
CREATE OR REPLACE FUNCTION trg_lock_summary_on_approval()
RETURNS TRIGGER AS $$
BEGIN
  -- When assignment is approved, lock the summary
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    UPDATE feedback_summaries fs
    SET 
      is_locked = true,
      locked_at = NOW(),
      locked_by = NEW.approved_by
    WHERE 
      fs.employee_id = NEW.employee_id
      AND fs.cycle_id = NEW.cycle_id;
  END IF;
  
  -- If rejected, reset summary lock
  IF NEW.status = 'rejected' AND OLD.status != 'rejected' THEN
    UPDATE feedback_summaries fs
    SET 
      is_locked = false,
      locked_at = NULL,
      locked_by = NULL
    WHERE 
      fs.employee_id = NEW.employee_id
      AND fs.cycle_id = NEW.cycle_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Drop old trigger if exists
DROP TRIGGER IF EXISTS trg_lock_summary_on_approval ON feedback_assignments;

-- 6. Create new trigger
CREATE TRIGGER trg_lock_summary_on_approval
AFTER UPDATE ON feedback_assignments
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION trg_lock_summary_on_approval();

-- 7. Add is_locked column to feedback_summaries if not exists
ALTER TABLE feedback_summaries
ADD COLUMN IF NOT EXISTS is_locked boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS locked_at timestamptz,
ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES employees(id);

-- 8. Verify changes
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'feedback_assignments'
AND column_name IN ('manager_comments', 'approved_by', 'approved_at', 'rejection_reason')
ORDER BY ordinal_position;

-- 9. Verify feedback_summaries changes
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'feedback_summaries'
AND column_name IN ('is_locked', 'locked_at', 'locked_by')
ORDER BY ordinal_position;

-- =====================================================
-- SAMPLE DATA FOR TESTING (Optional)
-- =====================================================
-- Uncomment untuk test dengan data dummy

/*
-- Get a submitted assignment for testing
UPDATE feedback_assignments fa
SET 
  status = 'submitted',
  submitted_at = NOW()
FROM feedback_cycles fc, employees e
WHERE fa.cycle_id = fc.id
AND fa.employee_id = e.id
AND fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP016'
AND fa.relationship_type = 'self';
*/
