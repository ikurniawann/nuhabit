-- ============================================================
-- SEED DATA: Complete 360° Feedback System
-- Generated from KPI 360 Data Dummy.xlsx
-- Includes: Cycle, Summaries dengan AI Insights
-- ============================================================

-- ============================================================
-- 1. FEEDBACK CYCLE
-- ============================================================
INSERT INTO feedback_cycles (id, name, period_label, start_date, end_date, status, kpi_weight, feedback_weight, is_anonymous, allow_self_assessment, require_manager_review) VALUES
  ('8df25b23-e059-456c-89f8-653e787adfd7', 'Q1 2026 Performance Review', 'Q1 2026', '2026-01-01', '2026-03-31', 'completed', 70.00, 30.00, true, true, true);

-- ============================================================
-- 2. FEEDBACK SUMMARIES (dengan AI Insights)
-- ============================================================
-- EMP001: KPI=68, 360°=82.8, Final=72.4 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.15, 4.64, 3.87,
  3.40, 4.63,
  82.76, 68.00, 72.43, 'C',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Komunikasi sangat efektif', 'Problem solver yang handal'], ARRAY['Perlu meningkatkan akuntabilitas']
FROM employees e WHERE e.nip = 'EMP001';

-- EMP002: KPI=65, 360°=80.7, Final=69.7 (D)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.10, 3.98, 4.34,
  4.50, 3.26,
  80.72, 65.00, 69.72, 'D',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Team player yang baik', 'Sangat bertanggung jawab dan dapat diandalkan'], ARRAY['Perlu mengembangkan kemampuan problem solving']
FROM employees e WHERE e.nip = 'EMP002';

-- EMP003: KPI=79, 360°=74.2, Final=77.6 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.00, 3.92, 3.67,
  3.65, 3.32,
  74.24, 79.00, 77.57, 'C',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat'], ARRAY['Perlu mengembangkan kemampuan problem solving']
FROM employees e WHERE e.nip = 'EMP003';

-- EMP004: KPI=87, 360°=66.2, Final=80.8 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.07, 3.53, 3.31,
  3.48, 3.15,
  66.16, 87.00, 80.75, 'B',
  'medium', 'medium',
  ARRAY['Menunjukkan konsistensi dalam bekerja'], ARRAY['Perlu meningkatkan kemampuan leadership', 'Perlu lebih aktif berkolaborasi dalam tim', 'Perlu meningkatkan akuntabilitas', 'Perlu mengembangkan kemampuan problem solving']
FROM employees e WHERE e.nip = 'EMP004';

-- EMP005: KPI=76, 360°=83.5, Final=78.2 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.29, 3.31, 4.15,
  4.15, 4.97,
  83.48, 76.00, 78.24, 'C',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Team player yang baik', 'Sangat bertanggung jawab dan dapat diandalkan', 'Problem solver yang handal'], ARRAY['Perlu meningkatkan komunikasi']
FROM employees e WHERE e.nip = 'EMP005';

-- EMP006: KPI=67, 360°=77.7, Final=70.2 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.95, 4.31, 3.24,
  3.78, 4.15,
  77.72, 67.00, 70.22, 'C',
  'medium', 'medium',
  ARRAY['Komunikasi sangat efektif', 'Problem solver yang handal'], ARRAY['Perlu lebih aktif berkolaborasi dalam tim']
FROM employees e WHERE e.nip = 'EMP006';

-- EMP007: KPI=84, 360°=71.6, Final=80.3 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.45, 3.55, 3.37,
  3.11, 4.41,
  71.56, 84.00, 80.27, 'B',
  'medium', 'medium',
  ARRAY['Problem solver yang handal'], ARRAY['Perlu meningkatkan kemampuan leadership', 'Perlu lebih aktif berkolaborasi dalam tim', 'Perlu meningkatkan akuntabilitas']
FROM employees e WHERE e.nip = 'EMP007';

-- EMP008: KPI=64, 360°=84.8, Final=70.2 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.51, 4.69, 4.35,
  3.89, 3.75,
  84.76, 64.00, 70.23, 'C',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Komunikasi sangat efektif', 'Team player yang baik'], ARRAY['Pertahankan performa dan terus berkembang']
FROM employees e WHERE e.nip = 'EMP008';

-- EMP009: KPI=70, 360°=82.1, Final=73.6 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.08, 4.80, 4.13,
  3.05, 4.46,
  82.08, 70.00, 73.62, 'C',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Komunikasi sangat efektif', 'Team player yang baik', 'Problem solver yang handal'], ARRAY['Perlu meningkatkan akuntabilitas']
FROM employees e WHERE e.nip = 'EMP009';

-- EMP010: KPI=87, 360°=75.8, Final=83.6 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.02, 3.80, 3.48,
  4.10, 3.54,
  75.76, 87.00, 83.63, 'B',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Sangat bertanggung jawab dan dapat diandalkan'], ARRAY['Perlu lebih aktif berkolaborasi dalam tim']
FROM employees e WHERE e.nip = 'EMP010';

-- EMP011: KPI=81, 360°=76.3, Final=79.6 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.30, 4.66, 4.18,
  3.30, 3.63,
  76.28, 81.00, 79.58, 'C',
  'medium', 'medium',
  ARRAY['Komunikasi sangat efektif', 'Team player yang baik'], ARRAY['Perlu meningkatkan kemampuan leadership', 'Perlu meningkatkan akuntabilitas']
FROM employees e WHERE e.nip = 'EMP011';

-- EMP012: KPI=84, 360°=76.6, Final=81.8 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.51, 3.28, 4.42,
  3.87, 4.08,
  76.64, 84.00, 81.79, 'B',
  'medium', 'medium',
  ARRAY['Team player yang baik', 'Problem solver yang handal'], ARRAY['Perlu meningkatkan komunikasi']
FROM employees e WHERE e.nip = 'EMP012';

-- EMP013: KPI=65, 360°=82.4, Final=70.2 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  5.00, 4.37, 3.24,
  3.80, 4.20,
  82.44, 65.00, 70.23, 'C',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Komunikasi sangat efektif', 'Problem solver yang handal'], ARRAY['Perlu lebih aktif berkolaborasi dalam tim']
FROM employees e WHERE e.nip = 'EMP013';

-- EMP014: KPI=89, 360°=78.8, Final=85.9 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.59, 4.48, 3.80,
  4.05, 3.77,
  78.76, 89.00, 85.93, 'B',
  'medium', 'medium',
  ARRAY['Komunikasi sangat efektif', 'Sangat bertanggung jawab dan dapat diandalkan'], ARRAY['Pertahankan performa dan terus berkembang']
FROM employees e WHERE e.nip = 'EMP014';

-- EMP015: KPI=69, 360°=80.4, Final=72.4 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.37, 3.00, 4.68,
  4.75, 4.30,
  80.40, 69.00, 72.42, 'C',
  'medium', 'medium',
  ARRAY['Team player yang baik', 'Sangat bertanggung jawab dan dapat diandalkan', 'Problem solver yang handal'], ARRAY['Perlu meningkatkan kemampuan leadership', 'Perlu meningkatkan komunikasi']
FROM employees e WHERE e.nip = 'EMP015';

-- EMP016: KPI=94, 360°=80.8, Final=90.0 (A)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.10, 4.86, 4.44,
  4.54, 3.26,
  80.80, 94.00, 90.04, 'A',
  'low', 'high',
  ARRAY['Komunikasi sangat efektif', 'Team player yang baik', 'Sangat bertanggung jawab dan dapat diandalkan'], ARRAY['Perlu meningkatkan kemampuan leadership', 'Perlu mengembangkan kemampuan problem solving']
FROM employees e WHERE e.nip = 'EMP016';

-- EMP017: KPI=71, 360°=79.9, Final=73.7 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.75, 4.08, 4.05,
  3.71, 3.39,
  79.92, 71.00, 73.68, 'C',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Komunikasi sangat efektif', 'Team player yang baik'], ARRAY['Perlu mengembangkan kemampuan problem solving']
FROM employees e WHERE e.nip = 'EMP017';

-- EMP018: KPI=68, 360°=88.5, Final=74.1 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.50, 3.94, 4.90,
  4.21, 4.57,
  88.48, 68.00, 74.14, 'C',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Team player yang baik', 'Sangat bertanggung jawab dan dapat diandalkan', 'Problem solver yang handal'], ARRAY['Pertahankan performa dan terus berkembang']
FROM employees e WHERE e.nip = 'EMP018';

-- EMP019: KPI=84, 360°=77.9, Final=82.2 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.80, 4.15, 4.45,
  3.62, 3.46,
  77.92, 84.00, 82.18, 'B',
  'medium', 'medium',
  ARRAY['Komunikasi sangat efektif', 'Team player yang baik'], ARRAY['Perlu mengembangkan kemampuan problem solving']
FROM employees e WHERE e.nip = 'EMP019';

-- EMP020: KPI=90, 360°=75.5, Final=85.6 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.92, 3.96, 3.36,
  3.60, 4.03,
  75.48, 90.00, 85.64, 'B',
  'medium', 'medium',
  ARRAY['Problem solver yang handal'], ARRAY['Perlu lebih aktif berkolaborasi dalam tim']
FROM employees e WHERE e.nip = 'EMP020';

-- EMP021: KPI=91, 360°=77.3, Final=86.9 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.21, 3.11, 3.49,
  4.59, 4.92,
  77.28, 91.00, 86.88, 'B',
  'medium', 'medium',
  ARRAY['Sangat bertanggung jawab dan dapat diandalkan', 'Problem solver yang handal'], ARRAY['Perlu meningkatkan kemampuan leadership', 'Perlu meningkatkan komunikasi', 'Perlu lebih aktif berkolaborasi dalam tim']
FROM employees e WHERE e.nip = 'EMP021';

-- EMP022: KPI=60, 360°=70.2, Final=63.0 (D)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.57, 3.39, 3.04,
  3.06, 4.48,
  70.16, 60.00, 63.05, 'D',
  'medium', 'medium',
  ARRAY['Problem solver yang handal'], ARRAY['Perlu meningkatkan komunikasi', 'Perlu lebih aktif berkolaborasi dalam tim', 'Perlu meningkatkan akuntabilitas']
FROM employees e WHERE e.nip = 'EMP022';

-- EMP023: KPI=78, 360°=80.4, Final=78.7 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.24, 3.69, 4.57,
  3.56, 4.05,
  80.44, 78.00, 78.73, 'C',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Team player yang baik', 'Problem solver yang handal'], ARRAY['Pertahankan performa dan terus berkembang']
FROM employees e WHERE e.nip = 'EMP023';

-- EMP024: KPI=71, 360°=82.4, Final=74.4 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.63, 3.84, 3.78,
  4.85, 4.50,
  82.40, 71.00, 74.42, 'C',
  'medium', 'medium',
  ARRAY['Sangat bertanggung jawab dan dapat diandalkan', 'Problem solver yang handal'], ARRAY['Pertahankan performa dan terus berkembang']
FROM employees e WHERE e.nip = 'EMP024';

-- EMP025: KPI=81, 360°=85.6, Final=82.4 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.21, 4.79, 3.61,
  4.79, 4.00,
  85.60, 81.00, 82.38, 'B',
  'low', 'high',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Komunikasi sangat efektif', 'Sangat bertanggung jawab dan dapat diandalkan', 'Problem solver yang handal'], ARRAY['Pertahankan performa dan terus berkembang']
FROM employees e WHERE e.nip = 'EMP025';

-- EMP026: KPI=76, 360°=74.5, Final=75.5 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.20, 3.19, 4.66,
  3.40, 3.17,
  74.48, 76.00, 75.54, 'C',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Team player yang baik'], ARRAY['Perlu meningkatkan komunikasi', 'Perlu meningkatkan akuntabilitas', 'Perlu mengembangkan kemampuan problem solving']
FROM employees e WHERE e.nip = 'EMP026';

-- EMP027: KPI=91, 360°=71.7, Final=85.2 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.08, 4.79, 3.56,
  3.43, 3.06,
  71.68, 91.00, 85.20, 'B',
  'medium', 'medium',
  ARRAY['Komunikasi sangat efektif'], ARRAY['Perlu meningkatkan kemampuan leadership', 'Perlu meningkatkan akuntabilitas', 'Perlu mengembangkan kemampuan problem solving']
FROM employees e WHERE e.nip = 'EMP027';

-- EMP028: KPI=64, 360°=87.0, Final=70.9 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.11, 4.86, 4.54,
  4.98, 3.27,
  87.04, 64.00, 70.91, 'C',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Komunikasi sangat efektif', 'Team player yang baik', 'Sangat bertanggung jawab dan dapat diandalkan'], ARRAY['Perlu mengembangkan kemampuan problem solving']
FROM employees e WHERE e.nip = 'EMP028';

-- EMP029: KPI=77, 360°=76.0, Final=76.7 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.58, 3.14, 3.40,
  4.28, 4.59,
  75.96, 77.00, 76.69, 'C',
  'medium', 'medium',
  ARRAY['Sangat bertanggung jawab dan dapat diandalkan', 'Problem solver yang handal'], ARRAY['Perlu meningkatkan komunikasi', 'Perlu lebih aktif berkolaborasi dalam tim']
FROM employees e WHERE e.nip = 'EMP029';

-- EMP030: KPI=95, 360°=73.0, Final=88.4 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.59, 3.90, 4.65,
  3.07, 3.05,
  73.04, 95.00, 88.41, 'B',
  'medium', 'medium',
  ARRAY['Team player yang baik'], ARRAY['Perlu meningkatkan akuntabilitas', 'Perlu mengembangkan kemampuan problem solving']
FROM employees e WHERE e.nip = 'EMP030';

-- EMP031: KPI=89, 360°=81.8, Final=86.8 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.03, 3.44, 3.20,
  4.98, 4.81,
  81.84, 89.00, 86.85, 'B',
  'low', 'high',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Sangat bertanggung jawab dan dapat diandalkan', 'Problem solver yang handal'], ARRAY['Perlu meningkatkan komunikasi', 'Perlu lebih aktif berkolaborasi dalam tim']
FROM employees e WHERE e.nip = 'EMP031';

-- EMP032: KPI=69, 360°=85.5, Final=74.0 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.40, 4.74, 3.56,
  4.08, 4.60,
  85.52, 69.00, 73.96, 'C',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Komunikasi sangat efektif', 'Sangat bertanggung jawab dan dapat diandalkan', 'Problem solver yang handal'], ARRAY['Pertahankan performa dan terus berkembang']
FROM employees e WHERE e.nip = 'EMP032';

-- EMP033: KPI=74, 360°=67.3, Final=72.0 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.40, 3.39, 3.10,
  3.08, 3.86,
  67.32, 74.00, 72.00, 'C',
  'medium', 'medium',
  ARRAY['Menunjukkan konsistensi dalam bekerja'], ARRAY['Perlu meningkatkan kemampuan leadership', 'Perlu meningkatkan komunikasi', 'Perlu lebih aktif berkolaborasi dalam tim', 'Perlu meningkatkan akuntabilitas']
FROM employees e WHERE e.nip = 'EMP033';

-- EMP034: KPI=68, 360°=84.2, Final=72.9 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.86, 4.18, 3.28,
  4.40, 4.34,
  84.24, 68.00, 72.87, 'C',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Komunikasi sangat efektif', 'Sangat bertanggung jawab dan dapat diandalkan', 'Problem solver yang handal'], ARRAY['Perlu lebih aktif berkolaborasi dalam tim']
FROM employees e WHERE e.nip = 'EMP034';

-- EMP035: KPI=93, 360°=82.3, Final=89.8 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.58, 3.97, 4.71,
  3.98, 3.33,
  82.28, 93.00, 89.78, 'B',
  'low', 'high',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Team player yang baik'], ARRAY['Perlu mengembangkan kemampuan problem solving']
FROM employees e WHERE e.nip = 'EMP035';

-- EMP036: KPI=64, 360°=76.7, Final=67.8 (D)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.69, 4.67, 3.02,
  4.41, 3.39,
  76.72, 64.00, 67.82, 'D',
  'medium', 'medium',
  ARRAY['Komunikasi sangat efektif', 'Sangat bertanggung jawab dan dapat diandalkan'], ARRAY['Perlu lebih aktif berkolaborasi dalam tim', 'Perlu mengembangkan kemampuan problem solving']
FROM employees e WHERE e.nip = 'EMP036';

-- EMP037: KPI=69, 360°=82.2, Final=73.0 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.49, 4.64, 3.07,
  4.71, 4.64,
  82.20, 69.00, 72.96, 'C',
  'medium', 'medium',
  ARRAY['Komunikasi sangat efektif', 'Sangat bertanggung jawab dan dapat diandalkan', 'Problem solver yang handal'], ARRAY['Perlu meningkatkan kemampuan leadership', 'Perlu lebih aktif berkolaborasi dalam tim']
FROM employees e WHERE e.nip = 'EMP037';

-- EMP038: KPI=82, 360°=82.7, Final=82.2 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  3.78, 4.22, 3.60,
  4.87, 4.21,
  82.72, 82.00, 82.22, 'B',
  'low', 'high',
  ARRAY['Komunikasi sangat efektif', 'Sangat bertanggung jawab dan dapat diandalkan', 'Problem solver yang handal'], ARRAY['Pertahankan performa dan terus berkembang']
FROM employees e WHERE e.nip = 'EMP038';

-- EMP039: KPI=80, 360°=73.6, Final=78.1 (C)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.60, 3.37, 3.84,
  3.48, 3.11,
  73.60, 80.00, 78.08, 'C',
  'medium', 'medium',
  ARRAY['Memiliki kemampuan leadership yang kuat'], ARRAY['Perlu meningkatkan komunikasi', 'Perlu meningkatkan akuntabilitas', 'Perlu mengembangkan kemampuan problem solving']
FROM employees e WHERE e.nip = 'EMP039';

-- EMP040: KPI=86, 360°=83.3, Final=85.2 (B)
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential, strengths, weaknesses
) SELECT
  gen_random_uuid(),
  '8df25b23-e059-456c-89f8-653e787adfd7',
  e.id,
  4.67, 4.73, 3.50,
  4.03, 3.89,
  83.28, 86.00, 85.18, 'B',
  'low', 'high',
  ARRAY['Memiliki kemampuan leadership yang kuat', 'Komunikasi sangat efektif', 'Sangat bertanggung jawab dan dapat diandalkan'], ARRAY['Pertahankan performa dan terus berkembang']
FROM employees e WHERE e.nip = 'EMP040';
