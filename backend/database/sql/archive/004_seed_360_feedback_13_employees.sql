-- ============================================================
-- 360° FEEDBACK DATA - 13 EMPLOYEES
-- Seed data untuk testing dengan employee yang ada
-- ============================================================

-- Pastikan cycle sudah ada
INSERT INTO feedback_cycles (id, name, period_label, start_date, end_date, status, kpi_weight, feedback_weight, is_anonymous, allow_self_assessment, require_manager_review) VALUES
  ('7b8c9563-60e3-4e11-9233-5ef98fec9dc8', 'Q1 2026 Performance Review', 'Q1 2026', '2026-01-01', '2026-03-31', 'completed', 70.00, 30.00, true, true, true)
ON CONFLICT (id) DO NOTHING;

-- Feedback Summaries untuk 13 employees
-- EMP-2026-00001: Test Employee - Grade A (Excellent)
INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) 
SELECT '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 
  4.8, 4.9, 4.7, 4.9, 4.8, 90.0, 92.0, 91.4, 'A', 'low', 'high', 
  ARRAY['Leadership luar biasa', 'Komunikasi sangat efektif', 'Team player excellent', 'Problem solver handal'], 
  ARRAY['Pertahankan performa']
FROM employees e WHERE e.nip = 'EMP-2026-00001'
ON CONFLICT (cycle_id, employee_id) DO NOTHING;

-- EMP-2026-00002: Ilham Kurniawan - Grade B (Good)
INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) 
SELECT '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 
  4.3, 4.5, 4.2, 4.6, 4.4, 86.0, 88.0, 87.2, 'B', 'low', 'high', 
  ARRAY['Leadership kuat', 'Komunikasi efektif', 'Bertanggung jawab', 'Problem solver baik'], 
  ARRAY['Tingkatkan delegasi']
FROM employees e WHERE e.nip = 'EMP-2026-00002'
ON CONFLICT (cycle_id, employee_id) DO NOTHING;

-- EMP-2026-00003: Ivan Alexander - Grade B (Good)
INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) 
SELECT '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 
  4.1, 4.3, 4.4, 4.2, 4.0, 84.0, 85.0, 84.7, 'B', 'medium', 'medium', 
  ARRAY['Team player baik', 'Komunikasi efektif', 'Bertanggung jawab'], 
  ARRAY['Tingkatkan leadership', 'Lebih proaktif']
FROM employees e WHERE e.nip = 'EMP-2026-00003'
ON CONFLICT (cycle_id, employee_id) DO NOTHING;

-- EMP-2026-00004: Aga Budiman - Grade C (Average)
INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) 
SELECT '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 
  3.5, 3.8, 3.6, 3.9, 3.7, 75.0, 78.0, 76.5, 'C', 'medium', 'medium', 
  ARRAY['Bertanggung jawab', 'Konsisten dalam bekerja'], 
  ARRAY['Tingkatkan komunikasi', 'Lebih aktif kolaborasi', 'Tingkatkan problem solving']
FROM employees e WHERE e.nip = 'EMP-2026-00004'
ON CONFLICT (cycle_id, employee_id) DO NOTHING;

-- EMP-2026-00005: Ilham Kurniawan - Grade B (Good)
INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) 
SELECT '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 
  4.2, 4.4, 4.1, 4.5, 4.3, 85.0, 87.0, 86.3, 'B', 'low', 'high', 
  ARRAY['Leadership kuat', 'Komunikasi efektif', 'Problem solver baik'], 
  ARRAY['Pertahankan performa']
FROM employees e WHERE e.nip = 'EMP-2026-00005'
ON CONFLICT (cycle_id, employee_id) DO NOTHING;

-- EMP-2026-00006: Gohan - Grade C (Average)
INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) 
SELECT '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 
  3.6, 3.7, 3.8, 3.5, 3.9, 75.0, 76.0, 75.6, 'C', 'medium', 'medium', 
  ARRAY['Team player baik', 'Problem solver cukup baik'], 
  ARRAY['Tingkatkan leadership', 'Tingkatkan akuntabilitas']
FROM employees e WHERE e.nip = 'EMP-2026-00006'
ON CONFLICT (cycle_id, employee_id) DO NOTHING;

-- EMP-2026-00007: Agus Sugi - Grade C (Average)
INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) 
SELECT '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 
  3.4, 3.6, 3.7, 3.8, 3.5, 74.0, 75.0, 74.6, 'C', 'medium', 'medium', 
  ARRAY['Kolaborasi baik', 'Bertanggung jawab'], 
  ARRAY['Tingkatkan komunikasi', 'Tingkatkan problem solving']
FROM employees e WHERE e.nip = 'EMP-2026-00007'
ON CONFLICT (cycle_id, employee_id) DO NOTHING;

-- EMP013: Employee 13 - Grade B (Good)
INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) 
SELECT '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 
  4.0, 4.2, 4.3, 4.1, 3.9, 83.0, 84.0, 83.7, 'B', 'medium', 'medium', 
  ARRAY['Team player baik', 'Komunikasi efektif'], 
  ARRAY['Tingkatkan problem solving']
FROM employees e WHERE e.nip = 'EMP013'
ON CONFLICT (cycle_id, employee_id) DO NOTHING;

-- EMP016: Employee 16 - Grade A (Excellent)
INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) 
SELECT '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 
  4.7, 4.8, 4.6, 4.9, 4.7, 91.0, 93.0, 92.3, 'A', 'low', 'high', 
  ARRAY['Leadership excellent', 'Komunikasi sangat baik', 'Team player outstanding', 'Bertanggung jawab tinggi'], 
  ARRAY['Pertahankan performa']
FROM employees e WHERE e.nip = 'EMP016'
ON CONFLICT (cycle_id, employee_id) DO NOTHING;

-- EMP017: Employee 17 - Grade C (Average)
INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) 
SELECT '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 
  3.5, 3.7, 3.6, 3.8, 3.4, 74.0, 76.0, 75.2, 'C', 'medium', 'medium', 
  ARRAY['Bertanggung jawab', 'Konsisten'], 
  ARRAY['Tingkatkan leadership', 'Tingkatkan problem solving', 'Lebih proaktif']
FROM employees e WHERE e.nip = 'EMP017'
ON CONFLICT (cycle_id, employee_id) DO NOTHING;

-- Tambah 3 employees lagi jika ada (EMP018, EMP019, EMP020 - adjust jika perlu)
INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) 
SELECT '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 
  3.8, 4.0, 3.9, 4.1, 3.7, 79.0, 80.0, 79.7, 'C', 'medium', 'medium', 
  ARRAY['Konsisten', 'Bertanggung jawab'], 
  ARRAY['Tingkatkan leadership', 'Tingkatkan inovasi']
FROM employees e WHERE e.nip = 'EMP018'
ON CONFLICT (cycle_id, employee_id) DO NOTHING;

INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) 
SELECT '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 
  4.1, 4.0, 4.2, 4.0, 4.1, 82.0, 83.0, 82.7, 'B', 'medium', 'medium', 
  ARRAY['Team player baik', 'Problem solver baik'], 
  ARRAY['Tingkatkan komunikasi']
FROM employees e WHERE e.nip = 'EMP019'
ON CONFLICT (cycle_id, employee_id) DO NOTHING;

INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) 
SELECT '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 
  3.9, 4.1, 4.0, 3.8, 4.2, 81.0, 82.0, 81.7, 'B', 'medium', 'medium', 
  ARRAY['Komunikasi baik', 'Problem solver baik'], 
  ARRAY['Tingkatkan kolaborasi']
FROM employees e WHERE e.nip = 'EMP020'
ON CONFLICT (cycle_id, employee_id) DO NOTHING;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- SELECT COUNT(*) FROM feedback_summaries WHERE cycle_id = '7b8c9563-60e3-4e11-9233-5ef98fec9dc8';
-- SELECT final_grade, COUNT(*) as count FROM feedback_summaries GROUP BY final_grade ORDER BY final_grade;
