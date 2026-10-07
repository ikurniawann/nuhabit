-- =====================================================
-- FORCE CREATE TEST SUBMISSION - SIMPLE & FIXED
-- =====================================================
-- Copy paste SELURUH isi ini ke psql atau SQL client
-- Klik RUN sekali saja
-- =====================================================

-- QUERY 1: Get cycle ID and employee ID
SELECT 
  fc.id as cycle_id,
  fc.name as cycle_name,
  e.id as employee_id,
  e.nip,
  e.full_name
FROM feedback_cycles fc
CROSS JOIN employees e
WHERE fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP016'
LIMIT 1;

-- QUERY 2: Create or update assignment
WITH cycle AS (
  SELECT id FROM feedback_cycles 
  WHERE name LIKE '%Q2 2026%' 
  ORDER BY created_at DESC LIMIT 1
),
emp AS (
  SELECT id, nip, full_name FROM employees WHERE nip = 'EMP016' LIMIT 1
)
INSERT INTO feedback_assignments (cycle_id, employee_id, reviewer_id, relationship_type, status, due_date)
SELECT c.id, e.id, e.id, 'self', 'submitted', NOW() + INTERVAL '14 days'
FROM cycle c, emp e
ON CONFLICT (cycle_id, employee_id, reviewer_id, relationship_type) 
DO UPDATE SET 
  status = 'submitted', 
  submitted_at = NOW()
RETURNING id as assignment_id;

-- QUERY 3: Insert 15 feedback responses
WITH assign AS (
  SELECT fa.id as assignment_id 
  FROM feedback_assignments fa
  JOIN feedback_cycles fc ON fa.cycle_id = fc.id
  JOIN employees e ON fa.employee_id = e.id
  WHERE fc.name LIKE '%Q2 2026%' 
  AND e.nip = 'EMP016' 
  AND fa.relationship_type = 'self'
  LIMIT 1
)
INSERT INTO feedback_responses (assignment_id, criteria_id, rating, comments)
SELECT 
  a.assignment_id,
  fcr.id,
  CASE 
    WHEN fcr.name LIKE '%tujuan%' THEN 5
    WHEN fcr.name LIKE '%feedback%' THEN 4
    WHEN fcr.name LIKE '%inspirasi%' THEN 5
    WHEN fcr.name LIKE '%verbal%' THEN 4
    WHEN fcr.name LIKE '%tertulis%' THEN 4
    WHEN fcr.name LIKE '%mendengarkan%' THEN 3
    WHEN fcr.name LIKE '%berbagi%' THEN 5
    WHEN fcr.name LIKE '%dukungan%' THEN 4
    WHEN fcr.name LIKE '%fleksibilitas%' THEN 4
    WHEN fcr.name LIKE '%komitmen%' THEN 5
    WHEN fcr.name LIKE '%tanggung%' THEN 4
    WHEN fcr.name LIKE '%inisiatif%' THEN 3
    WHEN fcr.name LIKE '%analisis%' THEN 4
    WHEN fcr.name LIKE '%solusi%' THEN 4
    WHEN fcr.name LIKE '%pengambilan%' THEN 3
    ELSE 3
  END as rating,
  CASE 
    WHEN fcr.name LIKE '%tujuan%' THEN 'Sangat baik dalam menetapkan target yang jelas'
    WHEN fcr.name LIKE '%inspirasi%' THEN 'Mampu memotivasi tim dengan baik'
    WHEN fcr.name LIKE '%verbal%' THEN 'Komunikasi jelas dan efektif'
    WHEN fcr.name LIKE '%dukungan%' THEN 'Selalu membantu rekan tim'
    WHEN fcr.name LIKE '%komitmen%' THEN 'Konsisten tepat waktu'
    ELSE NULL
  END as comments
FROM assign a
CROSS JOIN feedback_criteria fcr
JOIN feedback_categories fc ON fcr.category_id = fc.id
WHERE fc.is_active = true 
AND fcr.is_active = true
ON CONFLICT (assignment_id, criteria_id) DO UPDATE SET
  rating = EXCLUDED.rating,
  comments = EXCLUDED.comments;

-- QUERY 4: Verify submission
SELECT 
  fa.id as assignment_id,
  e.nip,
  e.full_name,
  fa.status,
  fa.submitted_at,
  COUNT(fr.id) as response_count,
  ROUND(AVG(fr.rating), 2) as avg_rating
FROM feedback_assignments fa
JOIN employees e ON fa.employee_id = e.id
LEFT JOIN feedback_responses fr ON fr.assignment_id = fa.id
JOIN feedback_cycles fc ON fa.cycle_id = fc.id
WHERE fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP016'
AND fa.relationship_type = 'self'
GROUP BY fa.id, e.nip, e.full_name, fa.status, fa.submitted_at;

-- QUERY 5: Final confirmation
SELECT 
  '✅ TEST SUBMISSION READY FOR APPROVAL!' as status,
  e.nip as employee_nip,
  e.full_name as employee_name,
  fc.name as cycle,
  fa.relationship_type,
  fa.status,
  COUNT(fr.id) as total_responses,
  ROUND(AVG(fr.rating), 2) as average_rating
FROM feedback_assignments fa
JOIN employees e ON fa.employee_id = e.id
JOIN feedback_cycles fc ON fa.cycle_id = fc.id
LEFT JOIN feedback_responses fr ON fr.assignment_id = fa.id
WHERE fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP016'
AND fa.relationship_type = 'self'
GROUP BY e.nip, e.full_name, fc.name, fa.relationship_type, fa.status;
