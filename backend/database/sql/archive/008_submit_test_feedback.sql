-- =====================================================
-- STEP 3: Submit Test Feedback Responses
-- =====================================================
-- Jalankan di admin database > SQL Editor
-- Untuk mensimulasikan submit feedback dari reviewer
-- =====================================================

-- 1. Get cycle ID and assignments for Q2 2026
SELECT 
  fc.id as cycle_id,
  fc.name as cycle_name,
  fa.id as assignment_id,
  e.nip as employee_nip,
  e.full_name as employee_name,
  r.full_name as reviewer_name,
  fa.relationship_type,
  fa.status
FROM feedback_assignments fa
JOIN feedback_cycles fc ON fa.cycle_id = fc.id
JOIN employees e ON fa.employee_id = e.id
JOIN employees r ON fa.reviewer_id = r.id
WHERE fc.name LIKE '%Q2 2026%'
AND fa.relationship_type = 'self'
AND e.nip = 'EMP001'
ORDER BY fa.created_at DESC
LIMIT 1;

-- Copy assignment_id dari hasil query di atas untuk test submit

-- 2. Get criteria IDs for all active categories
SELECT 
  fc.id as category_id,
  fc.name as category_name,
  fcr.id as criteria_id,
  fcr.name as criteria_name
FROM feedback_categories fc
JOIN feedback_criteria fcr ON fcr.category_id = fc.id
WHERE fc.is_active = true
AND fcr.is_active = true
ORDER BY fc.display_order, fcr.display_order;

-- 3. Submit test feedback responses untuk EMP001 self-assessment
-- GANTI 'YOUR_ASSIGNMENT_ID_HERE' dengan assignment_id dari query #1
WITH test_assignment AS (
  SELECT fa.id as assignment_id FROM feedback_assignments fa
  JOIN feedback_cycles fc ON fa.cycle_id = fc.id
  JOIN employees e ON fa.employee_id = e.id
  WHERE fc.name LIKE '%Q2 2026%'
  AND e.nip = 'EMP001'
  AND fa.relationship_type = 'self'
  LIMIT 1
),
inserted_responses AS (
  INSERT INTO feedback_responses (assignment_id, criteria_id, rating, comments)
  SELECT 
    ta.assignment_id,
    fcr.id,
    -- Vary ratings untuk test visualisasi
    CASE 
      WHEN fcr.name LIKE '%tujuan%' THEN 5
      WHEN fcr.name LIKE '%feedback%' THEN 4
      WHEN fcr.name LIKE '%inspirasi%' THEN 4
      WHEN fcr.name LIKE '%verbal%' THEN 5
      WHEN fcr.name LIKE '%tertulis%' THEN 4
      WHEN fcr.name LIKE '%mendengarkan%' THEN 3
      WHEN fcr.name LIKE '%berbagi%' THEN 4
      WHEN fcr.name LIKE '%dukungan%' THEN 5
      WHEN fcr.name LIKE '%fleksibilitas%' THEN 4
      WHEN fcr.name LIKE '%komitmen%' THEN 5
      WHEN fcr.name LIKE '%tanggung%' THEN 4
      WHEN fcr.name LIKE '%inisiatif%' THEN 3
      WHEN fcr.name LIKE '%analisis%' THEN 4
      WHEN fcr.name LIKE '%solusi%' THEN 4
      WHEN fcr.name LIKE '%pengambilan%' THEN 3
      ELSE 3
    END as rating,
    -- Add sample comments
    CASE 
      WHEN fcr.name LIKE '%tujuan%' THEN 'Sangat baik dalam menetapkan target yang jelas dan terukur'
      WHEN fcr.name LIKE '%inspirasi%' THEN 'Mampu memotivasi tim dengan contoh yang baik'
      WHEN fcr.name LIKE '%verbal%' THEN 'Komunikasi jelas dan mudah dipahami'
      WHEN fcr.name LIKE '%dukungan%' THEN 'Selalu membantu rekan tim saat dibutuhkan'
      WHEN fcr.name LIKE '%komitmen%' THEN 'Konsisten menyelesaikan tugas tepat waktu'
      ELSE NULL
    END as comments
  FROM test_assignment ta
  CROSS JOIN feedback_criteria fcr
  JOIN feedback_categories fc ON fcr.category_id = fc.id
  WHERE fc.is_active = true
  AND fcr.is_active = true
  ON CONFLICT (assignment_id, criteria_id) DO UPDATE SET
    rating = EXCLUDED.rating,
    comments = EXCLUDED.comments
)
UPDATE feedback_assignments fa
SET 
  status = 'submitted',
  submitted_at = NOW()
FROM test_assignment ta
WHERE fa.id = ta.assignment_id;

-- 4. Verify responses inserted
SELECT 
  fr.assignment_id,
  fc.name as category_name,
  fcr.name as criteria_name,
  fr.rating,
  fr.comments
FROM feedback_responses fr
JOIN feedback_criteria fcr ON fr.criteria_id = fcr.id
JOIN feedback_categories fc ON fcr.category_id = fc.id
JOIN feedback_assignments fa ON fr.assignment_id = fa.id
JOIN feedback_cycles fcyc ON fa.cycle_id = fcyc.id
JOIN employees e ON fa.employee_id = e.id
WHERE fcyc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP001'
AND fa.relationship_type = 'self'
ORDER BY fc.display_order, fcr.display_order;

-- 5. Check if trigger auto-calculated summary
SELECT 
  fs.id,
  e.nip,
  e.full_name,
  fs.overall_360_score,
  fs.final_grade,
  fs.strengths,
  fs.weaknesses
FROM feedback_summaries fs
JOIN employees e ON fs.employee_id = e.id
JOIN feedback_cycles fc ON fs.cycle_id = fc.id
WHERE fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP001';
