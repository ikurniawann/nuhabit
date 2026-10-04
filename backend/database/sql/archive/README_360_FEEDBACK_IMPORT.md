# 📥 360° Feedback Data Import Guide

## Overview

Panduan ini untuk mengimport data dummy dari Excel ke database 360° Feedback System.

## Source Files

### 1. KPI 360 Data Dummy.xlsx
- **Employees:** 40
- **Columns:** Employee ID, Name, Department, KPI Score, Leadership, Communication, Collaboration, Accountability, Problem Solving, 360 Avg Score, Final Score
- **Score Range:** 63.05 - 90.04
- **Features:** Complete behavioral scores (5 categories)

### 2. KPI 369 Dashboard.xlsx
- **Employees:** 40 (different dataset)
- **Columns:** Emp ID, Name, Dept, KPI, 360, Final
- **Score Range:** 65.20 - 93.40
- **Features:** Simple format, ranking included

### 3. KPI 360 Combined Dummy.xlsx (Generated)
- **Employees:** 80 (combined from both files)
- **Score Range:** 63.05 - 93.40
- **Features:** All data normalized + behavioral scores generated

## Migration Files

```
migrations/
├── 003_360_feedback_system.sql          # Core schema (8 tables)
├── 004_seed_360_feedback_complete.sql   # 40 employees (detailed)
├── 004_seed_360_combined.sql            # 80 employees (combined)
└── README_360_FEEDBACK_IMPORT.md        # This file
```

## Import Steps

### Option A: Import 40 Employees (Detailed Behavioral Data)

**Use this if:** You want complete behavioral scores for each employee.

```sql
-- Step 1: Create core schema
-- Run: migrations/003_360_feedback_system.sql

-- Step 2: Ensure employees exist with NIP EMP001-EMP040
-- You can import from Excel or create manually

-- Step 3: Import feedback summaries
-- Run: migrations/004_seed_360_feedback_complete.sql
```

### Option B: Import 80 Employees (Combined Dataset)

**Use this if:** You want more data for testing/demo.

```sql
-- Step 1: Create core schema
-- Run: migrations/003_360_feedback_system.sql

-- Step 2: Ensure employees exist with NIP E001-E040 and EMP001-EMP040

-- Step 3: Import combined feedback summaries
-- Run: migrations/004_seed_360_combined.sql
```

### Option C: admin database Import (Recommended)

1. **Open admin database**
   - Go to PostgreSQL admin
   - Select your project
   - Navigate to SQL Editor

2. **Run Core Schema**
   ```
   -- Copy & paste content from:
   -- migrations/003_360_feedback_system.sql
   -- Click "Run"
   ```

3. **Create Employees** (if not exists)
   ```sql
   -- Example for creating employees
   INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date)
   VALUES 
     ('EMP001', 'Employee 1', 'emp001@company.com', <dept_id>, 'permanent', '2024-01-01'),
     ('EMP002', 'Employee 2', 'emp002@company.com', <dept_id>, 'permanent', '2024-01-01'),
     -- ... add all 40 or 80 employees
   ON CONFLICT (nip) DO NOTHING;
   ```

4. **Import Feedback Data**
   ```
   -- Copy & paste content from:
   -- migrations/004_seed_360_combined.sql (for 80 employees)
   -- OR
   -- migrations/004_seed_360_feedback_complete.sql (for 40 employees)
   -- Click "Run"
   ```

5. **Verify Import**
   ```sql
   -- Check cycle
   SELECT * FROM feedback_cycles;
   
   -- Check summaries count
   SELECT COUNT(*) FROM feedback_summaries;
   
   -- Check grade distribution
   SELECT final_grade, COUNT(*) as count
   FROM feedback_summaries
   GROUP BY final_grade
   ORDER BY final_grade;
   ```

## Data Statistics

### Combined Dataset (80 employees)

| Metric | Value |
|--------|-------|
| Total Employees | 80 |
| Score Range | 63.05 - 93.40 |
| Average Score | ~78.5 |
| Departments | HR, Marketing, IT, Sales, Operations |

### Grade Distribution

| Grade | Count | Percentage | Description |
|-------|-------|------------|-------------|
| A | 5 | 6.25% | Excellent (≥90) |
| B | 29 | 36.25% | Good (80-89) |
| C | 35 | 43.75% | Average (70-79) |
| D | 11 | 13.75% | Below Average (60-69) |
| E | 0 | 0% | Poor (<60) |

## Troubleshooting

### Issue: "Foreign key violation on employee_id"

**Solution:** Ensure employees exist before importing summaries.

```sql
-- Check if employee exists
SELECT id, nip, full_name FROM employees WHERE nip = 'EMP001';

-- If not found, create employee first
INSERT INTO employees (nip, full_name, email, department_id, employment_status, join_date)
VALUES ('EMP001', 'Employee 1', 'emp001@company.com', <dept_id>, 'permanent', '2024-01-01');
```

### Issue: "Department not found"

**Solution:** Create departments first.

```sql
-- Create departments
INSERT INTO departments (name, code) VALUES
  ('HR', 'HR'),
  ('Marketing', 'MKT'),
  ('IT', 'IT'),
  ('Sales', 'SLS'),
  ('Operations', 'OPS')
ON CONFLICT (name) DO NOTHING;
```

### Issue: "Duplicate key value violates unique constraint"

**Solution:** Data already imported. Use TRUNCATE to reset.

```sql
-- Clear existing data (CAREFUL: This deletes all feedback data!)
TRUNCATE TABLE development_plans CASCADE;
TRUNCATE TABLE feedback_summaries CASCADE;
TRUNCATE TABLE feedback_responses CASCADE;
TRUNCATE TABLE feedback_assignments CASCADE;
TRUNCATE TABLE feedback_cycles CASCADE;

-- Then re-run import
```

## Post-Import Verification

After import, verify data in UI:

1. **Navigate to:** `/dashboard/hris/performance/360-feedback/cycles`
   - Should see "Q1 2026 Performance Review" cycle

2. **Navigate to:** `/dashboard/hris/performance/360-feedback/results`
   - Should see 40 or 80 employees with scores
   - Check AI insights (strengths, weaknesses)
   - Verify burnout risk & promotion potential

3. **Check Dashboard Stats:**
   - Average score should match ~78.5
   - Grade distribution should match table above
   - Top performers should have Grade A/B

## Next Steps After Import

1. **Test Feedback Submission**
   - Go to `/dashboard/hris/performance/360-feedback/submit`
   - Try submitting feedback for an employee

2. **Create Development Plans**
   - Based on weaknesses identified
   - Link to training programs

3. **Enable AI Features** (Phase 2)
   - Sentiment analysis for comments
   - Bias detection
   - Predictive insights

## Support

If you encounter issues:
1. Check PostgreSQL / app logs
2. Verify table schema matches migration
3. Ensure all prerequisite tables exist (employees, departments, etc.)
4. Contact: Bang Ilham
