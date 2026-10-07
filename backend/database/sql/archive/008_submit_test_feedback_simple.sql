-- =====================================================
-- STEP 3: Submit Test Feedback - SIMPLE VERSION (FIXED)
-- =====================================================
-- Menggunakan EMP013 yang ada di database
-- Copy paste SEMUA isi file ini ke psql atau SQL client
-- Lalu klik RUN sekali saja
-- =====================================================

-- QUERY 1: Get assignment_id untuk EMP013 self-assessment
SELECT 
  fa.id as assignment_id,
  e.nip,
  e.full_name,
  fa.relationship_type,
  fa.status
FROM feedback_assignments fa
JOIN feedback_cycles fc ON fa.cycle_id = fc.id
JOIN employees e ON fa.employee_id = e.id
WHERE fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP013'
AND fa.relationship_type = 'self'
LIMIT 1;

-- QUERY 2: Insert 15 feedback responses dengan varied ratings
INSERT INTO feedback_responses (assignment_id, criteria_id, rating, comments)
SELECT 
  fa.id,
  fcr.id,
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
  CASE 
    WHEN fcr.name LIKE '%tujuan%' THEN 'Sangat baik dalam menetapkan target yang jelas'
    WHEN fcr.name LIKE '%inspirasi%' THEN 'Mampu memotivasi tim dengan baik'
    WHEN fcr.name LIKE '%verbal%' THEN 'Komunikasi jelas dan efektif'
    WHEN fcr.name LIKE '%dukungan%' THEN 'Selalu membantu rekan tim'
    WHEN fcr.name LIKE '%komitmen%' THEN 'Konsisten tepat waktu'
    ELSE NULL
  END as comments
FROM feedback_assignments fa
JOIN feedback_cycles fc ON fa.cycle_id = fc.id
JOIN employees e ON fa.employee_id = e.id
CROSS JOIN feedback_criteria fcr
JOIN feedback_categories fcat ON fcr.category_id = fcat.id
WHERE fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP013'
AND fa.relationship_type = 'self'
AND fcat.is_active = true
AND fcr.is_active = true
ON CONFLICT (assignment_id, criteria_id) DO UPDATE SET
  rating = EXCLUDED.rating,
  comments = EXCLUDED.comments;

-- QUERY 3: Update assignment status to submitted
UPDATE feedback_assignments fa
SET 
  status = 'submitted',
  submitted_at = NOW()
FROM feedback_cycles fc, employees e
WHERE fa.cycle_id = fc.id
AND fa.employee_id = e.id
AND fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP013'
AND fa.relationship_type = 'self';

-- QUERY 4: Verify responses inserted (should show 15 rows)
SELECT 
  fcat.name as category,
  fcr.name as criteria,
  fr.rating,
  fr.comments
FROM feedback_responses fr
JOIN feedback_criteria fcr ON fr.criteria_id = fcr.id
JOIN feedback_categories fcat ON fcr.category_id = fcat.id
JOIN feedback_assignments fa ON fr.assignment_id = fa.id
JOIN feedback_cycles fc ON fa.cycle_id = fc.id
JOIN employees e ON fa.employee_id = e.id
WHERE fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP013'
AND fa.relationship_type = 'self'
ORDER BY fcat.display_order, fcr.display_order;

-- QUERY 5: Check auto-generated summary (trigger should have calculated this)
SELECT 
  e.nip,
  e.full_name,
  fs.overall_360_score,
  fs.kpi_score,
  fs.final_score,
  fs.final_grade,
  fs.burnout_risk,
  fs.promotion_potential,
  fs.strengths,
  fs.weaknesses
FROM feedback_summaries fs
JOIN employees e ON fs.employee_id = e.id
JOIN feedback_cycles fc ON fs.cycle_id = fc.id
WHERE fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP013';

-- QUERY 6: If summary doesn't exist, manually trigger calculation
INSERT INTO feedback_summaries (
  cycle_id,
  employee_id,
  leadership_score,
  communication_score,
  collaboration_score,
  accountability_score,
  problem_solving_score,
  overall_360_score,
  kpi_score,
  final_score,
  final_grade,
  burnout_risk,
  promotion_potential,
  strengths,
  weaknesses
)
SELECT 
  fc.id as cycle_id,
  e.id as employee_id,
  
  -- Category averages (rating is 1-5, convert to 0-100)
  AVG(CASE WHEN fcat.name = 'Leadership' THEN fr.rating * 20.0 ELSE NULL END) as leadership_score,
  AVG(CASE WHEN fcat.name = 'Communication' THEN fr.rating * 20.0 ELSE NULL END) as communication_score,
  AVG(CASE WHEN fcat.name = 'Collaboration' THEN fr.rating * 20.0 ELSE NULL END) as collaboration_score,
  AVG(CASE WHEN fcat.name = 'Accountability' THEN fr.rating * 20.0 ELSE NULL END) as accountability_score,
  AVG(CASE WHEN fcat.name = 'Problem Solving' THEN fr.rating * 20.0 ELSE NULL END) as problem_solving_score,
  
  -- Overall 360 score (average of all categories)
  AVG(fr.rating) * 20.0 as overall_360_score,
  
  -- KPI score (dummy value for testing)
  75.0 as kpi_score,
  
  -- Final score: 70% KPI + 30% 360
  (75.0 * 0.7) + (AVG(fr.rating) * 20.0 * 0.3) as final_score,
  
  -- Grade
  CASE 
    WHEN (75.0 * 0.7) + (AVG(fr.rating) * 20.0 * 0.3) >= 90 THEN 'A'
    WHEN (75.0 * 0.7) + (AVG(fr.rating) * 20.0 * 0.3) >= 80 THEN 'B'
    WHEN (75.0 * 0.7) + (AVG(fr.rating) * 20.0 * 0.3) >= 70 THEN 'C'
    WHEN (75.0 * 0.7) + (AVG(fr.rating) * 20.0 * 0.3) >= 60 THEN 'D'
    ELSE 'E'
  END as final_grade,
  
  -- Burnout risk (based on variance in scores)
  CASE 
    WHEN STDDEV(fr.rating) > 1.0 THEN 'high'
    WHEN STDDEV(fr.rating) > 0.5 THEN 'medium'
    ELSE 'low'
  END as burnout_risk,
  
  -- Promotion potential
  CASE 
    WHEN AVG(fr.rating) >= 4.5 THEN 'high'
    WHEN AVG(fr.rating) >= 3.5 THEN 'medium'
    ELSE 'low'
  END as promotion_potential,
  
  -- AI-generated strengths (top 2 categories)
  ARRAY[
    (SELECT fcat.name || ': ' || STRING_AGG(fcr.name, ', ') 
     FROM feedback_responses fr2 
     JOIN feedback_criteria fcr ON fr2.criteria_id = fcr.id 
     JOIN feedback_categories fcat ON fcr.category_id = fcat.id 
     WHERE fr2.assignment_id = fa.id AND fr2.rating >= 4
     GROUP BY fcat.name ORDER BY AVG(fr2.rating) DESC LIMIT 1),
    'Komitmen tinggi terhadap deadline dan kualitas kerja'
  ]::text[] as strengths,
  
  -- AI-generated weaknesses (bottom 2 categories)
  ARRAY[
    (SELECT fcat.name || ': Perlu peningkatan dalam ' || STRING_AGG(fcr.name, ', ') 
     FROM feedback_responses fr2 
     JOIN feedback_criteria fcr ON fr2.criteria_id = fcr.id 
     JOIN feedback_categories fcat ON fcr.category_id = fcat.id 
     WHERE fr2.assignment_id = fa.id AND fr2.rating <= 3
     GROUP BY fcat.name ORDER BY AVG(fr2.rating) ASC LIMIT 1),
    'Perlu lebih proaktif dalam mengambil inisiatif'
  ]::text[] as weaknesses
  
FROM feedback_assignments fa
JOIN feedback_cycles fc ON fa.cycle_id = fc.id
JOIN employees e ON fa.employee_id = e.id
JOIN feedback_responses fr ON fr.assignment_id = fa.id
JOIN feedback_criteria fcr ON fr.criteria_id = fcr.id
JOIN feedback_categories fcat ON fcr.category_id = fcat.id
WHERE fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP013'
AND fa.relationship_type = 'self'
GROUP BY fc.id, e.id, fa.id
ON CONFLICT (cycle_id, employee_id) DO UPDATE SET
  leadership_score = EXCLUDED.leadership_score,
  communication_score = EXCLUDED.communication_score,
  collaboration_score = EXCLUDED.collaboration_score,
  accountability_score = EXCLUDED.accountability_score,
  problem_solving_score = EXCLUDED.problem_solving_score,
  overall_360_score = EXCLUDED.overall_360_score,
  kpi_score = EXCLUDED.kpi_score,
  final_score = EXCLUDED.final_score,
  final_grade = EXCLUDED.final_grade,
  burnout_risk = EXCLUDED.burnout_risk,
  promotion_potential = EXCLUDED.promotion_potential,
  strengths = EXCLUDED.strengths,
  weaknesses = EXCLUDED.weaknesses,
  updated_at = NOW();

-- QUERY 7: Final verification - Show complete summary
SELECT 
  '✅ FEEDBACK SUBMITTED SUCCESSFULLY!' as status,
  e.nip,
  e.full_name,
  ROUND(fs.final_score, 1) as final_score,
  fs.final_grade as grade,
  ROUND(fs.overall_360_score, 1) as three_sixty_score,
  fs.burnout_risk,
  fs.promotion_potential,
  array_length(fs.strengths, 1) as num_strengths,
  array_length(fs.weaknesses, 1) as num_weaknesses
FROM feedback_summaries fs
JOIN employees e ON fs.employee_id = e.id
JOIN feedback_cycles fc ON fs.cycle_id = fc.id
WHERE fc.name LIKE '%Q2 2026%'
AND e.nip = 'EMP013';
