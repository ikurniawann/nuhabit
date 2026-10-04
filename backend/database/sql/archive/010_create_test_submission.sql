-- =====================================================
-- CREATE TEST SUBMISSION FOR APPROVAL TESTING
-- =====================================================
-- Jalankan di admin database > SQL Editor
-- Untuk membuat test submission yang bisa di-approve
-- =====================================================

-- 1. First, check if assignment exists for EMP016
SELECT 
  fa.id as assignment_id,
  e.nip,
  e.full_name,
  fa.status,
  fc.name as cycle_name
FROM feedback_assignments fa
JOIN feedback_cycles fc ON fa.cycle_id = fc.id
JOIN employees e ON fa.employee_id = e.id
WHERE fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP016'
AND fa.relationship_type = 'self';

-- 2. If no assignment exists, create it
INSERT INTO feedback_assignments (
  cycle_id,
  employee_id,
  reviewer_id,
  relationship_type,
  status,
  due_date
)
SELECT 
  fc.id,
  e.id,
  e.id,
  'self',
  'pending',
  NOW() + INTERVAL '14 days'
FROM feedback_cycles fc
CROSS JOIN employees e
WHERE fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP016'
ON CONFLICT (cycle_id, employee_id, reviewer_id, relationship_type) DO NOTHING;

-- 3. Insert 15 feedback responses
WITH assignment AS (
  SELECT fa.id
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
  a.id,
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
    WHEN fcr.name LIKE '%tujuan%' THEN 'Sangat baik dalam menetapkan target yang jelas dan terukur untuk tim'
    WHEN fcr.name LIKE '%inspirasi%' THEN 'Mampu memotivasi rekan tim dengan memberikan contoh yang baik'
    WHEN fcr.name LIKE '%verbal%' THEN 'Komunikasi verbal jelas dan mudah dipahami dalam setiap meeting'
    WHEN fcr.name LIKE '%dukungan%' THEN 'Selalu bersedia membantu rekan tim yang mengalami kesulitan'
    WHEN fcr.name LIKE '%komitmen%' THEN 'Konsisten menyelesaikan tugas tepat waktu dengan kualitas baik'
    ELSE NULL
  END as comments
FROM assignment a
CROSS JOIN feedback_criteria fcr
JOIN feedback_categories fcat ON fcr.category_id = fcat.id
WHERE fcat.is_active = true
AND fcr.is_active = true
ON CONFLICT (assignment_id, criteria_id) DO UPDATE SET
  rating = EXCLUDED.rating,
  comments = EXCLUDED.comments;

-- 4. Update assignment status to submitted
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

-- 5. Verify submission created
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

-- 6. Show summary of what was created
SELECT 
  '✅ TEST SUBMISSION CREATED!' as status,
  e.nip,
  e.full_name,
  fc.name as cycle,
  fa.relationship_type,
  fa.status,
  COUNT(fr.id) as total_responses,
  ROUND(AVG(fr.rating), 2) as average_rating,
  fa.submitted_at
FROM feedback_assignments fa
JOIN employees e ON fa.employee_id = e.id
JOIN feedback_cycles fc ON fa.cycle_id = fc.id
LEFT JOIN feedback_responses fr ON fr.assignment_id = fa.id
WHERE fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP016'
AND fa.relationship_type = 'self'
GROUP BY e.nip, e.full_name, fc.name, fa.relationship_type, fa.status, fa.submitted_at;
