-- ============================================================
-- IMPORT EMPLOYEES WITH ALL REQUIRED FIELDS
-- Fixed: phone, gender, address, city NOT NULL constraints
-- ============================================================

-- EMP001: Employee 1 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP001', 'Employee 1', 'emp001@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234000000', 'male', 'Jl. Employee No. 1', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP001');

-- EMP002: Employee 2 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP002', 'Employee 2', 'emp002@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234000107', 'female', 'Jl. Employee No. 2', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP002');

-- EMP003: Employee 3 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP003', 'Employee 3', 'emp003@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234000214', 'male', 'Jl. Employee No. 3', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP003');

-- EMP004: Employee 4 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP004', 'Employee 4', 'emp004@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234000321', 'female', 'Jl. Employee No. 4', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP004');

-- EMP005: Employee 5 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP005', 'Employee 5', 'emp005@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234000428', 'male', 'Jl. Employee No. 5', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP005');

-- EMP006: Employee 6 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP006', 'Employee 6', 'emp006@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234000535', 'female', 'Jl. Employee No. 6', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP006');

-- EMP007: Employee 7 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP007', 'Employee 7', 'emp007@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234000642', 'male', 'Jl. Employee No. 7', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP007');

-- EMP008: Employee 8 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP008', 'Employee 8', 'emp008@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234000749', 'female', 'Jl. Employee No. 8', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP008');

-- EMP009: Employee 9 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP009', 'Employee 9', 'emp009@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234000856', 'male', 'Jl. Employee No. 9', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP009');

-- EMP010: Employee 10 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP010', 'Employee 10', 'emp010@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234000963', 'female', 'Jl. Employee No. 10', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP010');

-- EMP011: Employee 11 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP011', 'Employee 11', 'emp011@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234001070', 'male', 'Jl. Employee No. 11', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP011');

-- EMP012: Employee 12 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP012', 'Employee 12', 'emp012@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234001177', 'female', 'Jl. Employee No. 12', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP012');

-- EMP013: Employee 13 (Operations)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP013', 'Employee 13', 'emp013@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234001284', 'male', 'Jl. Employee No. 13', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP013');

-- EMP014: Employee 14 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP014', 'Employee 14', 'emp014@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234001391', 'female', 'Jl. Employee No. 14', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP014');

-- EMP015: Employee 15 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP015', 'Employee 15', 'emp015@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234001498', 'male', 'Jl. Employee No. 15', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP015');

-- EMP016: Employee 16 (Operations)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP016', 'Employee 16', 'emp016@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234001505', 'female', 'Jl. Employee No. 16', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP016');

-- EMP017: Employee 17 (Operations)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP017', 'Employee 17', 'emp017@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234001612', 'male', 'Jl. Employee No. 17', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP017');

-- EMP018: Employee 18 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP018', 'Employee 18', 'emp018@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234001719', 'female', 'Jl. Employee No. 18', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP018');

-- EMP019: Employee 19 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP019', 'Employee 19', 'emp019@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234001826', 'male', 'Jl. Employee No. 19', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP019');

-- EMP020: Employee 20 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP020', 'Employee 20', 'emp020@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234001933', 'female', 'Jl. Employee No. 20', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP020');

-- EMP021: Employee 21 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP021', 'Employee 21', 'emp021@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234002040', 'male', 'Jl. Employee No. 21', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP021');

-- EMP022: Employee 22 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP022', 'Employee 22', 'emp022@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234002147', 'female', 'Jl. Employee No. 22', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP022');

-- EMP023: Employee 23 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP023', 'Employee 23', 'emp023@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234002254', 'male', 'Jl. Employee No. 23', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP023');

-- EMP024: Employee 24 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP024', 'Employee 24', 'emp024@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234002361', 'female', 'Jl. Employee No. 24', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP024');

-- EMP025: Employee 25 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP025', 'Employee 25', 'emp025@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234002468', 'male', 'Jl. Employee No. 25', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP025');

-- EMP026: Employee 26 (Operations)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP026', 'Employee 26', 'emp026@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234002575', 'female', 'Jl. Employee No. 26', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP026');

-- EMP027: Employee 27 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP027', 'Employee 27', 'emp027@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234002682', 'male', 'Jl. Employee No. 27', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP027');

-- EMP028: Employee 28 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP028', 'Employee 28', 'emp028@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234002789', 'female', 'Jl. Employee No. 28', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP028');

-- EMP029: Employee 29 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP029', 'Employee 29', 'emp029@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234002896', 'male', 'Jl. Employee No. 29', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP029');

-- EMP030: Employee 30 (Operations)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP030', 'Employee 30', 'emp030@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234002903', 'female', 'Jl. Employee No. 30', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP030');

-- EMP031: Employee 31 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP031', 'Employee 31', 'emp031@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234003010', 'male', 'Jl. Employee No. 31', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP031');

-- EMP032: Employee 32 (Operations)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP032', 'Employee 32', 'emp032@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234003117', 'female', 'Jl. Employee No. 32', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP032');

-- EMP033: Employee 33 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP033', 'Employee 33', 'emp033@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234003224', 'male', 'Jl. Employee No. 33', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP033');

-- EMP034: Employee 34 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP034', 'Employee 34', 'emp034@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234003331', 'female', 'Jl. Employee No. 34', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP034');

-- EMP035: Employee 35 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP035', 'Employee 35', 'emp035@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234003438', 'male', 'Jl. Employee No. 35', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP035');

-- EMP036: Employee 36 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP036', 'Employee 36', 'emp036@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234003545', 'female', 'Jl. Employee No. 36', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP036');

-- EMP037: Employee 37 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP037', 'Employee 37', 'emp037@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234003652', 'male', 'Jl. Employee No. 37', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP037');

-- EMP038: Employee 38 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP038', 'Employee 38', 'emp038@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234003759', 'female', 'Jl. Employee No. 38', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP038');

-- EMP039: Employee 39 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP039', 'Employee 39', 'emp039@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234003866', 'male', 'Jl. Employee No. 39', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP039');

-- EMP040: Employee 40 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'EMP040', 'Employee 40', 'emp040@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234003973', 'female', 'Jl. Employee No. 40', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'EMP040');

-- E001: Employee 1 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E001', 'Employee 1', 'e001@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234004080', 'male', 'Jl. Employee No. 41', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E001');

-- E002: Employee 2 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E002', 'Employee 2', 'e002@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234004187', 'female', 'Jl. Employee No. 42', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E002');

-- E003: Employee 3 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E003', 'Employee 3', 'e003@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234004294', 'male', 'Jl. Employee No. 43', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E003');

-- E004: Employee 4 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E004', 'Employee 4', 'e004@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234004301', 'female', 'Jl. Employee No. 44', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E004');

-- E005: Employee 5 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E005', 'Employee 5', 'e005@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234004408', 'male', 'Jl. Employee No. 45', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E005');

-- E006: Employee 6 (Ops)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E006', 'Employee 6', 'e006@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234004515', 'female', 'Jl. Employee No. 46', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E006');

-- E007: Employee 7 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E007', 'Employee 7', 'e007@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234004622', 'male', 'Jl. Employee No. 47', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E007');

-- E008: Employee 8 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E008', 'Employee 8', 'e008@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234004729', 'female', 'Jl. Employee No. 48', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E008');

-- E009: Employee 9 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E009', 'Employee 9', 'e009@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234004836', 'male', 'Jl. Employee No. 49', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E009');

-- E010: Employee 10 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E010', 'Employee 10', 'e010@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234004943', 'female', 'Jl. Employee No. 50', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E010');

-- E011: Employee 11 (Ops)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E011', 'Employee 11', 'e011@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234005050', 'male', 'Jl. Employee No. 51', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E011');

-- E012: Employee 12 (Ops)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E012', 'Employee 12', 'e012@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234005157', 'female', 'Jl. Employee No. 52', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E012');

-- E013: Employee 13 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E013', 'Employee 13', 'e013@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234005264', 'male', 'Jl. Employee No. 53', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E013');

-- E014: Employee 14 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E014', 'Employee 14', 'e014@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234005371', 'female', 'Jl. Employee No. 54', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E014');

-- E015: Employee 15 (Ops)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E015', 'Employee 15', 'e015@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234005478', 'male', 'Jl. Employee No. 55', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E015');

-- E016: Employee 16 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E016', 'Employee 16', 'e016@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234005585', 'female', 'Jl. Employee No. 56', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E016');

-- E017: Employee 17 (Ops)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E017', 'Employee 17', 'e017@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234005692', 'male', 'Jl. Employee No. 57', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E017');

-- E018: Employee 18 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E018', 'Employee 18', 'e018@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234005799', 'female', 'Jl. Employee No. 58', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E018');

-- E019: Employee 19 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E019', 'Employee 19', 'e019@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234005806', 'male', 'Jl. Employee No. 59', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E019');

-- E020: Employee 20 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E020', 'Employee 20', 'e020@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234005913', 'female', 'Jl. Employee No. 60', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E020');

-- E021: Employee 21 (Ops)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E021', 'Employee 21', 'e021@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234006020', 'male', 'Jl. Employee No. 61', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E021');

-- E022: Employee 22 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E022', 'Employee 22', 'e022@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234006127', 'female', 'Jl. Employee No. 62', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E022');

-- E023: Employee 23 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E023', 'Employee 23', 'e023@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234006234', 'male', 'Jl. Employee No. 63', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E023');

-- E024: Employee 24 (Ops)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E024', 'Employee 24', 'e024@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234006341', 'female', 'Jl. Employee No. 64', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E024');

-- E025: Employee 25 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E025', 'Employee 25', 'e025@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234006448', 'male', 'Jl. Employee No. 65', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E025');

-- E026: Employee 26 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E026', 'Employee 26', 'e026@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234006555', 'female', 'Jl. Employee No. 66', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E026');

-- E027: Employee 27 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E027', 'Employee 27', 'e027@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234006662', 'male', 'Jl. Employee No. 67', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E027');

-- E028: Employee 28 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E028', 'Employee 28', 'e028@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234006769', 'female', 'Jl. Employee No. 68', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E028');

-- E029: Employee 29 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E029', 'Employee 29', 'e029@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234006876', 'male', 'Jl. Employee No. 69', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E029');

-- E030: Employee 30 (HR)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E030', 'Employee 30', 'e030@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567893', 'permanent', '2024-01-01', NOW(), '081234006983', 'female', 'Jl. Employee No. 70', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E030');

-- E031: Employee 31 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E031', 'Employee 31', 'e031@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234007090', 'male', 'Jl. Employee No. 71', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E031');

-- E032: Employee 32 (Ops)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E032', 'Employee 32', 'e032@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234007197', 'female', 'Jl. Employee No. 72', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E032');

-- E033: Employee 33 (Marketing)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E033', 'Employee 33', 'e033@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567892', 'permanent', '2024-01-01', NOW(), '081234007204', 'male', 'Jl. Employee No. 73', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E033');

-- E034: Employee 34 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E034', 'Employee 34', 'e034@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234007311', 'female', 'Jl. Employee No. 74', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E034');

-- E035: Employee 35 (Ops)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E035', 'Employee 35', 'e035@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234007418', 'male', 'Jl. Employee No. 75', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E035');

-- E036: Employee 36 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E036', 'Employee 36', 'e036@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234007525', 'female', 'Jl. Employee No. 76', 'Jakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E036');

-- E037: Employee 37 (Ops)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E037', 'Employee 37', 'e037@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567894', 'permanent', '2024-01-01', NOW(), '081234007632', 'male', 'Jl. Employee No. 77', 'Bandung'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E037');

-- E038: Employee 38 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E038', 'Employee 38', 'e038@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234007739', 'female', 'Jl. Employee No. 78', 'Surabaya'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E038');

-- E039: Employee 39 (IT)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E039', 'Employee 39', 'e039@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'permanent', '2024-01-01', NOW(), '081234007846', 'male', 'Jl. Employee No. 79', 'Yogyakarta'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E039');

-- E040: Employee 40 (Sales)
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date, created_at, phone, gender, address, city)
SELECT 'E040', 'Employee 40', 'e040@company.com', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', 'permanent', '2024-01-01', NOW(), '081234007953', 'female', 'Jl. Employee No. 80', 'Medan'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE nip = 'E040');
