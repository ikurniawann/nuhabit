-- ============================================================
-- SEED DATA: 360° Feedback System
-- Generated from KPI 360 Data Dummy.xlsx
-- ============================================================

-- 1. Create Feedback Cycle
INSERT INTO feedback_cycles (id, name, period_label, start_date, end_date, status, kpi_weight, feedback_weight, is_anonymous, allow_self_assessment, require_manager_review) VALUES
  ('550e8400-e29b-41d4-a716-446655440001', 'Q1 2026 Performance Review', 'Q1 2026', '2026-01-01', '2026-03-31', 'completed', 70.00, 30.00, true, true, true);

-- 2. Create Employees (if not exists)
-- Employee: EMP001 - Employee 1 (IT)
-- Employee: EMP002 - Employee 2 (IT)
-- Employee: EMP003 - Employee 3 (Sales)
-- Employee: EMP004 - Employee 4 (Marketing)
-- Employee: EMP005 - Employee 5 (Marketing)
-- Employee: EMP006 - Employee 6 (HR)
-- Employee: EMP007 - Employee 7 (Sales)
-- Employee: EMP008 - Employee 8 (HR)
-- Employee: EMP009 - Employee 9 (Sales)
-- Employee: EMP010 - Employee 10 (Sales)
-- Employee: EMP011 - Employee 11 (HR)
-- Employee: EMP012 - Employee 12 (HR)
-- Employee: EMP013 - Employee 13 (Operations)
-- Employee: EMP014 - Employee 14 (Marketing)
-- Employee: EMP015 - Employee 15 (Marketing)
-- Employee: EMP016 - Employee 16 (Operations)
-- Employee: EMP017 - Employee 17 (Operations)
-- Employee: EMP018 - Employee 18 (IT)
-- Employee: EMP019 - Employee 19 (IT)
-- Employee: EMP020 - Employee 20 (Sales)
-- Employee: EMP021 - Employee 21 (Marketing)
-- Employee: EMP022 - Employee 22 (Marketing)
-- Employee: EMP023 - Employee 23 (Marketing)
-- Employee: EMP024 - Employee 24 (HR)
-- Employee: EMP025 - Employee 25 (Marketing)
-- Employee: EMP026 - Employee 26 (Operations)
-- Employee: EMP027 - Employee 27 (Marketing)
-- Employee: EMP028 - Employee 28 (IT)
-- Employee: EMP029 - Employee 29 (IT)
-- Employee: EMP030 - Employee 30 (Operations)
-- Employee: EMP031 - Employee 31 (Sales)
-- Employee: EMP032 - Employee 32 (Operations)
-- Employee: EMP033 - Employee 33 (IT)
-- Employee: EMP034 - Employee 34 (HR)
-- Employee: EMP035 - Employee 35 (IT)
-- Employee: EMP036 - Employee 36 (HR)
-- Employee: EMP037 - Employee 37 (Sales)
-- Employee: EMP038 - Employee 38 (Sales)
-- Employee: EMP039 - Employee 39 (IT)
-- Employee: EMP040 - Employee 40 (HR)

-- 3. Create Feedback Summaries
-- Note: Assumes employees exist. Update employee_id with actual UUIDs after import.

-- EMP001: Employee 1
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP001'),
  4.15, 4.64, 3.87,
  3.40, 4.63,
  82.76, 68.00, 72.43, 'C',
  'medium', 'medium'
);

-- EMP002: Employee 2
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP002'),
  4.10, 3.98, 4.34,
  4.50, 3.26,
  80.72, 65.00, 69.72, 'D',
  'medium', 'medium'
);

-- EMP003: Employee 3
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP003'),
  4.00, 3.92, 3.67,
  3.65, 3.32,
  74.24, 79.00, 77.57, 'C',
  'medium', 'medium'
);

-- EMP004: Employee 4
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP004'),
  3.07, 3.53, 3.31,
  3.48, 3.15,
  66.16, 87.00, 80.75, 'B',
  'medium', 'medium'
);

-- EMP005: Employee 5
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP005'),
  4.29, 3.31, 4.15,
  4.15, 4.97,
  83.48, 76.00, 78.24, 'C',
  'medium', 'medium'
);

-- EMP006: Employee 6
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP006'),
  3.95, 4.31, 3.24,
  3.78, 4.15,
  77.72, 67.00, 70.22, 'C',
  'medium', 'medium'
);

-- EMP007: Employee 7
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP007'),
  3.45, 3.55, 3.37,
  3.11, 4.41,
  71.56, 84.00, 80.27, 'B',
  'medium', 'medium'
);

-- EMP008: Employee 8
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP008'),
  4.51, 4.69, 4.35,
  3.89, 3.75,
  84.76, 64.00, 70.23, 'C',
  'medium', 'medium'
);

-- EMP009: Employee 9
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP009'),
  4.08, 4.80, 4.13,
  3.05, 4.46,
  82.08, 70.00, 73.62, 'C',
  'medium', 'medium'
);

-- EMP010: Employee 10
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP010'),
  4.02, 3.80, 3.48,
  4.10, 3.54,
  75.76, 87.00, 83.63, 'B',
  'medium', 'medium'
);

-- EMP011: Employee 11
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP011'),
  3.30, 4.66, 4.18,
  3.30, 3.63,
  76.28, 81.00, 79.58, 'C',
  'medium', 'medium'
);

-- EMP012: Employee 12
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP012'),
  3.51, 3.28, 4.42,
  3.87, 4.08,
  76.64, 84.00, 81.79, 'B',
  'medium', 'medium'
);

-- EMP013: Employee 13
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP013'),
  5.00, 4.37, 3.24,
  3.80, 4.20,
  82.44, 65.00, 70.23, 'C',
  'medium', 'medium'
);

-- EMP014: Employee 14
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP014'),
  3.59, 4.48, 3.80,
  4.05, 3.77,
  78.76, 89.00, 85.93, 'B',
  'medium', 'medium'
);

-- EMP015: Employee 15
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP015'),
  3.37, 3.00, 4.68,
  4.75, 4.30,
  80.40, 69.00, 72.42, 'C',
  'medium', 'medium'
);

-- EMP016: Employee 16
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP016'),
  3.10, 4.86, 4.44,
  4.54, 3.26,
  80.80, 94.00, 90.04, 'A',
  'low', 'high'
);

-- EMP017: Employee 17
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP017'),
  4.75, 4.08, 4.05,
  3.71, 3.39,
  79.92, 71.00, 73.68, 'C',
  'medium', 'medium'
);

-- EMP018: Employee 18
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP018'),
  4.50, 3.94, 4.90,
  4.21, 4.57,
  88.48, 68.00, 74.14, 'C',
  'medium', 'medium'
);

-- EMP019: Employee 19
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP019'),
  3.80, 4.15, 4.45,
  3.62, 3.46,
  77.92, 84.00, 82.18, 'B',
  'medium', 'medium'
);

-- EMP020: Employee 20
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP020'),
  3.92, 3.96, 3.36,
  3.60, 4.03,
  75.48, 90.00, 85.64, 'B',
  'medium', 'medium'
);

-- EMP021: Employee 21
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP021'),
  3.21, 3.11, 3.49,
  4.59, 4.92,
  77.28, 91.00, 86.88, 'B',
  'medium', 'medium'
);

-- EMP022: Employee 22
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP022'),
  3.57, 3.39, 3.04,
  3.06, 4.48,
  70.16, 60.00, 63.05, 'D',
  'medium', 'medium'
);

-- EMP023: Employee 23
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP023'),
  4.24, 3.69, 4.57,
  3.56, 4.05,
  80.44, 78.00, 78.73, 'C',
  'medium', 'medium'
);

-- EMP024: Employee 24
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP024'),
  3.63, 3.84, 3.78,
  4.85, 4.50,
  82.40, 71.00, 74.42, 'C',
  'medium', 'medium'
);

-- EMP025: Employee 25
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP025'),
  4.21, 4.79, 3.61,
  4.79, 4.00,
  85.60, 81.00, 82.38, 'B',
  'low', 'high'
);

-- EMP026: Employee 26
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP026'),
  4.20, 3.19, 4.66,
  3.40, 3.17,
  74.48, 76.00, 75.54, 'C',
  'medium', 'medium'
);

-- EMP027: Employee 27
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP027'),
  3.08, 4.79, 3.56,
  3.43, 3.06,
  71.68, 91.00, 85.20, 'B',
  'medium', 'medium'
);

-- EMP028: Employee 28
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP028'),
  4.11, 4.86, 4.54,
  4.98, 3.27,
  87.04, 64.00, 70.91, 'C',
  'medium', 'medium'
);

-- EMP029: Employee 29
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP029'),
  3.58, 3.14, 3.40,
  4.28, 4.59,
  75.96, 77.00, 76.69, 'C',
  'medium', 'medium'
);

-- EMP030: Employee 30
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP030'),
  3.59, 3.90, 4.65,
  3.07, 3.05,
  73.04, 95.00, 88.41, 'B',
  'medium', 'medium'
);

-- EMP031: Employee 31
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP031'),
  4.03, 3.44, 3.20,
  4.98, 4.81,
  81.84, 89.00, 86.85, 'B',
  'low', 'high'
);

-- EMP032: Employee 32
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP032'),
  4.40, 4.74, 3.56,
  4.08, 4.60,
  85.52, 69.00, 73.96, 'C',
  'medium', 'medium'
);

-- EMP033: Employee 33
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP033'),
  3.40, 3.39, 3.10,
  3.08, 3.86,
  67.32, 74.00, 72.00, 'C',
  'medium', 'medium'
);

-- EMP034: Employee 34
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP034'),
  4.86, 4.18, 3.28,
  4.40, 4.34,
  84.24, 68.00, 72.87, 'C',
  'medium', 'medium'
);

-- EMP035: Employee 35
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP035'),
  4.58, 3.97, 4.71,
  3.98, 3.33,
  82.28, 93.00, 89.78, 'B',
  'low', 'high'
);

-- EMP036: Employee 36
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP036'),
  3.69, 4.67, 3.02,
  4.41, 3.39,
  76.72, 64.00, 67.82, 'D',
  'medium', 'medium'
);

-- EMP037: Employee 37
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP037'),
  3.49, 4.64, 3.07,
  4.71, 4.64,
  82.20, 69.00, 72.96, 'C',
  'medium', 'medium'
);

-- EMP038: Employee 38
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP038'),
  3.78, 4.22, 3.60,
  4.87, 4.21,
  82.72, 82.00, 82.22, 'B',
  'low', 'high'
);

-- EMP039: Employee 39
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP039'),
  4.60, 3.37, 3.84,
  3.48, 3.11,
  73.60, 80.00, 78.08, 'C',
  'medium', 'medium'
);

-- EMP040: Employee 40
INSERT INTO feedback_summaries (
  id, cycle_id, employee_id,
  leadership_score, communication_score, collaboration_score,
  accountability_score, problem_solving_score,
  overall_360_score, kpi_score, final_score, final_grade,
  burnout_risk, promotion_potential
) VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440001',
  (SELECT id FROM employees WHERE nip = 'EMP040'),
  4.67, 4.73, 3.50,
  4.03, 3.89,
  83.28, 86.00, 85.18, 'B',
  'low', 'high'
);
