-- =====================================================
-- STEP 2: Assign Reviewers for Testing (FIXED)
-- =====================================================
-- Menggunakan employees yang ada: EMP013, EMP016, EMP017, EMP026, EMP030
-- Jalankan di admin database > SQL Editor
-- =====================================================

-- 1. Verify cycle Q2 2026 exists
SELECT 
  id as cycle_uuid,
  name,
  period_label,
  status,
  created_at
FROM feedback_cycles
WHERE name LIKE '%Q2 2026%'
ORDER BY created_at DESC
LIMIT 1;

-- 2. Assign reviewers untuk 5 test employees
WITH target_cycle AS (
  SELECT id FROM feedback_cycles 
  WHERE name LIKE '%Q2 2026%' 
  ORDER BY created_at DESC LIMIT 1
),
test_employees AS (
  SELECT id, nip, full_name, department_id
  FROM employees 
  WHERE nip IN ('EMP013', 'EMP016', 'EMP017', 'EMP026', 'EMP030')
),
-- Use first employee (EMP013) as manager for all test employees
manager_employee AS (
  SELECT id FROM employees WHERE nip = 'EMP013' LIMIT 1
),
manager_assignments AS (
  INSERT INTO feedback_assignments (
    cycle_id,
    employee_id,
    reviewer_id,
    relationship_type,
    status,
    due_date
  )
  SELECT 
    tc.id,
    te.id,
    me.id,
    'manager',
    'pending',
    NOW() + INTERVAL '14 days'
  FROM target_cycle tc, test_employees te, manager_employee me
  ON CONFLICT (cycle_id, employee_id, reviewer_id, relationship_type) DO NOTHING
),
self_assignments AS (
  INSERT INTO feedback_assignments (
    cycle_id,
    employee_id,
    reviewer_id,
    relationship_type,
    status,
    due_date
  )
  SELECT 
    tc.id,
    te.id,
    te.id,
    'self',
    'pending',
    NOW() + INTERVAL '14 days'
  FROM target_cycle tc, test_employees te
  ON CONFLICT (cycle_id, employee_id, reviewer_id, relationship_type) DO NOTHING
),
peer_assignments AS (
  INSERT INTO feedback_assignments (
    cycle_id,
    employee_id,
    reviewer_id,
    relationship_type,
    status,
    due_date
  )
  SELECT 
    tc.id,
    te1.id,
    te2.id,
    'peer',
    'pending',
    NOW() + INTERVAL '14 days'
  FROM target_cycle tc
  CROSS JOIN test_employees te1
  CROSS JOIN test_employees te2
  WHERE te1.id != te2.id
  ON CONFLICT (cycle_id, employee_id, reviewer_id, relationship_type) DO NOTHING
)
SELECT '✅ Assignments created successfully!' as status;

-- 3. Verify assignments created
SELECT 
  fa.id,
  e.nip as employee_nip,
  e.full_name as employee_name,
  r.full_name as reviewer_name,
  fa.relationship_type,
  fa.status,
  fa.due_date,
  fc.name as cycle_name
FROM feedback_assignments fa
JOIN employees e ON fa.employee_id = e.id
JOIN employees r ON fa.reviewer_id = r.id
JOIN feedback_cycles fc ON fa.cycle_id = fc.id
WHERE fc.name LIKE '%Q2 2026%'
ORDER BY e.nip, fa.relationship_type;

-- 4. Count assignments by type
SELECT 
  fa.relationship_type,
  COUNT(*) as count,
  fa.status
FROM feedback_assignments fa
JOIN feedback_cycles fc ON fa.cycle_id = fc.id
WHERE fc.name LIKE '%Q2 2026%'
GROUP BY fa.relationship_type, fa.status;
