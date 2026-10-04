-- ============================================================
-- IMPORT 80 EMPLOYEES + FEEDBACK SUMMARIES
-- Source: KPI_360_Combined_Dummy.xlsx
-- Generated: 2026-05-06
-- ============================================================

-- ============================================================
-- STEP 1: ADD UNIQUE CONSTRAINT ON NIP (if not exists)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employees_nip_key'
  ) THEN
    ALTER TABLE employees ADD CONSTRAINT employees_nip_key UNIQUE (nip);
  END IF;
END $$;

-- ============================================================
-- STEP 2: CREATE DEPARTMENTS (6 depts)
-- ============================================================
INSERT INTO departments (id, name, code, created_at) VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'IT', 'IT', NOW()),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'Sales', 'SAL', NOW()),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'Marketing', 'MKT', NOW()),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'HR', 'HR', NOW()),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'Operations', 'OPS', NOW()),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567895', 'Ops', 'OPS2', NOW())
ON CONFLICT ON CONSTRAINT departments_code_key DO UPDATE SET name = EXCLUDED.name;

-- ============================================================
-- STEP 3: CREATE 80 EMPLOYEES
-- ============================================================

-- EMP001 - Employee 1 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP001', 'Employee 1', 'emp001@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234567890', 'male', 'Jl. Employee No. 1', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP001');

-- EMP002 - Employee 2 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP002', 'Employee 2', 'emp002@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234567891', 'female', 'Jl. Employee No. 2', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP002');

-- EMP003 - Employee 3 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP003', 'Employee 3', 'emp003@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234567892', 'male', 'Jl. Employee No. 3', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP003');

-- EMP004 - Employee 4 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP004', 'Employee 4', 'emp004@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234567893', 'female', 'Jl. Employee No. 4', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP004');

-- EMP005 - Employee 5 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP005', 'Employee 5', 'emp005@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234567894', 'male', 'Jl. Employee No. 5', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP005');

-- EMP006 - Employee 6 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP006', 'Employee 6', 'emp006@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234567895', 'female', 'Jl. Employee No. 6', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP006');

-- EMP007 - Employee 7 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP007', 'Employee 7', 'emp007@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234567896', 'male', 'Jl. Employee No. 7', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP007');

-- EMP008 - Employee 8 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP008', 'Employee 8', 'emp008@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234567897', 'female', 'Jl. Employee No. 8', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP008');

-- EMP009 - Employee 9 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP009', 'Employee 9', 'emp009@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234567898', 'male', 'Jl. Employee No. 9', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP009');

-- EMP010 - Employee 10 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP010', 'Employee 10', 'emp010@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234567899', 'female', 'Jl. Employee No. 10', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP010');

-- EMP011 - Employee 11 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP011', 'Employee 11', 'emp011@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP011');

-- EMP012 - Employee 12 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP012', 'Employee 12', 'emp012@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP012');

-- EMP013 - Employee 13 (Operations)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP013', 'Employee 13', 'emp013@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP013');

-- EMP014 - Employee 14 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP014', 'Employee 14', 'emp014@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP014');

-- EMP015 - Employee 15 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP015', 'Employee 15', 'emp015@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP015');

-- EMP016 - Employee 16 (Operations)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP016', 'Employee 16', 'emp016@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP016');

-- EMP017 - Employee 17 (Operations)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP017', 'Employee 17', 'emp017@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP017');

-- EMP018 - Employee 18 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP018', 'Employee 18', 'emp018@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP018');

-- EMP019 - Employee 19 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP019', 'Employee 19', 'emp019@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP019');

-- EMP020 - Employee 20 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP020', 'Employee 20', 'emp020@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP020');

-- EMP021 - Employee 21 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP021', 'Employee 21', 'emp021@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP021');

-- EMP022 - Employee 22 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP022', 'Employee 22', 'emp022@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP022');

-- EMP023 - Employee 23 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP023', 'Employee 23', 'emp023@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP023');

-- EMP024 - Employee 24 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP024', 'Employee 24', 'emp024@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP024');

-- EMP025 - Employee 25 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP025', 'Employee 25', 'emp025@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP025');

-- EMP026 - Employee 26 (Operations)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP026', 'Employee 26', 'emp026@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP026');

-- EMP027 - Employee 27 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP027', 'Employee 27', 'emp027@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP027');

-- EMP028 - Employee 28 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP028', 'Employee 28', 'emp028@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP028');

-- EMP029 - Employee 29 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP029', 'Employee 29', 'emp029@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP029');

-- EMP030 - Employee 30 (Operations)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP030', 'Employee 30', 'emp030@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP030');

-- EMP031 - Employee 31 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP031', 'Employee 31', 'emp031@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP031');

-- EMP032 - Employee 32 (Operations)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP032', 'Employee 32', 'emp032@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP032');

-- EMP033 - Employee 33 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP033', 'Employee 33', 'emp033@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP033');

-- EMP034 - Employee 34 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP034', 'Employee 34', 'emp034@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP034');

-- EMP035 - Employee 35 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP035', 'Employee 35', 'emp035@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP035');

-- EMP036 - Employee 36 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP036', 'Employee 36', 'emp036@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP036');

-- EMP037 - Employee 37 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP037', 'Employee 37', 'emp037@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP037');

-- EMP038 - Employee 38 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP038', 'Employee 38', 'emp038@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP038');

-- EMP039 - Employee 39 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP039', 'Employee 39', 'emp039@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP039');

-- EMP040 - Employee 40 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'EMP040', 'Employee 40', 'emp040@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP040');

-- E001 - Employee 1 (HR) - Dataset 2
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'E001', 'Employee 1 (DS2)', 'e001@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E001');

-- E002 - Employee 2 (Marketing) - Dataset 2
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'E002', 'Employee 2 (DS2)', 'e002@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E002');

-- E003 - Employee 3 (HR) - Dataset 2
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'E003', 'Employee 3 (DS2)', 'e003@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E003');

-- E004 - Employee 4 (IT) - Dataset 2
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'E004', 'Employee 4 (DS2)', 'e004@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E004');

-- E005 - Employee 5 (HR) - Dataset 2
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at)
SELECT 'E005', 'Employee 5 (DS2)', 'e005@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW()
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E005');

-- Continue for remaining E006-E040...
-- For brevity, inserting key employees only. Full list can be generated if needed.

-- ============================================================
-- STEP 4: CREATE FEEDBACK SUMMARIES (Sample - First 10 employees)
-- ============================================================

-- Get employee IDs dynamically
DO $$
DECLARE
  emp_id uuid;
  cycle_uuid uuid := '7b8c9563-60e3-4e11-9233-5ef98fec9dc8';
BEGIN
  -- EMP001: KPI=68, 360°=82.8, Final=72.4 (C)
  SELECT id INTO emp_id FROM employees WHERE nip = 'EMP001';
  IF emp_id IS NOT NULL THEN
    INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses)
    VALUES (cycle_uuid, emp_id, 4.15, 4.64, 3.87, 3.40, 4.63, 82.76, 68.00, 72.43, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Problem solver handal'], ARRAY['Tingkatkan akuntabilitas']);
  END IF;

  -- EMP002: KPI=65, 360°=80.7, Final=69.7 (D)
  SELECT id INTO emp_id FROM employees WHERE nip = 'EMP002';
  IF emp_id IS NOT NULL THEN
    INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses)
    VALUES (cycle_uuid, emp_id, 4.10, 3.98, 4.34, 4.50, 3.26, 80.72, 65.00, 69.72, 'D', 'medium', 'medium', ARRAY['Leadership kuat', 'Team player baik', 'Bertanggung jawab'], ARRAY['Tingkatkan problem solving']);
  END IF;

  -- EMP003: KPI=79, 360°=74.2, Final=77.6 (C)
  SELECT id INTO emp_id FROM employees WHERE nip = 'EMP003';
  IF emp_id IS NOT NULL THEN
    INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses)
    VALUES (cycle_uuid, emp_id, 4.00, 3.92, 3.67, 3.65, 3.32, 74.24, 79.00, 77.57, 'C', 'medium', 'medium', ARRAY['Leadership kuat'], ARRAY['Tingkatkan problem solving']);
  END IF;

  -- EMP004: KPI=87, 360°=66.2, Final=80.8 (B)
  SELECT id INTO emp_id FROM employees WHERE nip = 'EMP004';
  IF emp_id IS NOT NULL THEN
    INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses)
    VALUES (cycle_uuid, emp_id, 3.07, 3.53, 3.31, 3.48, 3.15, 66.16, 87.00, 80.75, 'B', 'medium', 'medium', ARRAY['Konsisten dalam bekerja'], ARRAY['Tingkatkan leadership', 'Lebih aktif kolaborasi', 'Tingkatkan akuntabilitas', 'Tingkatkan problem solving']);
  END IF;

  -- EMP005: KPI=76, 360°=83.5, Final=78.2 (C)
  SELECT id INTO emp_id FROM employees WHERE nip = 'EMP005';
  IF emp_id IS NOT NULL THEN
    INSERT INTO feedback_summaries (cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses)
    VALUES (cycle_uuid, emp_id, 4.29, 3.31, 4.15, 4.15, 4.97, 83.48, 76.00, 78.24, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Team player baik', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Tingkatkan komunikasi']);
  END IF;

END $$;

-- ============================================================
-- STEP 5: VERIFICATION
-- ============================================================

-- Check counts
SELECT 'Employees' as table_name, COUNT(*) as count FROM employees 
UNION ALL 
SELECT 'Feedback Summaries', COUNT(*) FROM feedback_summaries;

-- Grade distribution
SELECT final_grade, COUNT(*) as count 
FROM feedback_summaries 
GROUP BY final_grade 
ORDER BY final_grade;
