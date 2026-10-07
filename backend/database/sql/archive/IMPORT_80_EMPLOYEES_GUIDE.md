# 📥 Import 80 Employees + Feedback Data

## Overview

Import data dari `KPI_360_Combined_Dummy.xlsx` ke database 360° Feedback System.

## Files Generated

- **SQL Script:** `migrations/006_import_80_employees_with_feedback.sql`
- **Source:** `KPI_360_Combined_Dummy.xlsx` (80 employees)

## Data Statistics

### Employees
- **Total:** 80 employees
- **Departments:** 6 (IT, Sales, Marketing, HR, Operations, Ops)
- **NIP Format:** EMP001 - EMP080

### Grade Distribution
| Grade | Count | Percentage | Description |
|-------|-------|------------|-------------|
| A | 5 | 6.2% | Excellent (≥90) |
| B | 29 | 36.2% | Good (80-89) |
| C | 35 | 43.8% | Average (70-79) |
| D | 11 | 13.8% | Below Average (60-69) |
| E | 0 | 0.0% | Poor (<60) |

**Score Range:** 63.05 - 93.40  
**Average Score:** ~78.5

## Import Steps

### Option 1: admin database (Recommended)

```
1. Buka PostgreSQL admin
2. Pilih project "talentpool"
3. SQL Editor
4. Copy semua isi file: migrations/006_import_80_employees_with_feedback.sql
5. Klik "Run" atau tekan Ctrl+Enter / Cmd+Enter
6. Tunggu hingga selesai (biasanya < 10 detik)
7. Lihat hasil di panel output
```

### Option 2: Command Line (psql)

```bash
cd /Users/ilham/Desktop/talentpool
psql $DATABASE_URL -f migrations/006_import_80_employees_with_feedback.sql
```

### Option 3: Direct Database Connection

```bash
psql -h <host> -U postgres -d talentpool -f migrations/006_import_80_employees_with_feedback.sql
```

## What This Script Does

### 1. Create Departments (6 depts)
```sql
INSERT INTO departments (id, name, code) VALUES
  -- IT, Sales, Marketing, HR, Operations, Ops
```

### 2. Create 80 Employees
```sql
INSERT INTO employees (id, nip, full_name, email, department_id, ...)
VALUES
  ('uuid-1', 'EMP001', 'Employee 1', 'emp001@company.com', ...),
  ('uuid-2', 'EMP002', 'Employee 2', 'emp002@company.com', ...),
  -- ... 80 employees total
ON CONFLICT (nip) DO UPDATE SET ...;
```

### 3. Create Feedback Summaries
```sql
INSERT INTO feedback_summaries (
  cycle_id, employee_id,
  leadership_score, communication_score, ...,
  final_score, final_grade,
  strengths, weaknesses,
  burnout_risk, promotion_potential
) VALUES
  -- 80 summaries dengan AI-generated insights
```

## Verification Queries

After import, run these to verify:

```sql
-- Check counts
SELECT 'Employees' as table_name, COUNT(*) as count 
FROM employees 
UNION ALL 
SELECT 'Feedback Summaries', COUNT(*) FROM feedback_summaries;

-- Expected: 80 employees, 80 summaries

-- Grade distribution
SELECT 
  final_grade, 
  COUNT(*) as count, 
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage 
FROM feedback_summaries 
GROUP BY final_grade 
ORDER BY final_grade;

-- Expected: A:5, B:29, C:35, D:11, E:0

-- Sample employees by department
SELECT 
  d.name as department,
  COUNT(e.id) as employee_count,
  ROUND(AVG(fs.final_score), 2) as avg_score
FROM employees e
JOIN departments d ON e.department_id = d.id
LEFT JOIN feedback_summaries fs ON e.id = fs.employee_id
GROUP BY d.name
ORDER BY employee_count DESC;
```

## Post-Import Actions

### 1. View in UI
Navigate to:
```
http://localhost:3000/dashboard/hris/performance/360-feedback/results
```

You should see 80 employees with their performance data.

### 2. Test Export
1. Go to test page: `/dashboard/hris/performance/360-feedback/test-data`
2. Click "Create Test Data" (uses first employee)
3. Click "Export PDF" to download report

### 3. Check Radar Chart
Verify all 5 behavioral metrics are displayed correctly for different employees.

## Troubleshooting

### Issue: "Duplicate key value violates unique constraint"

**Cause:** Employees already exist with same NIP.

**Solution:** The script uses `ON CONFLICT DO UPDATE`, so it should be safe to run multiple times. If error persists:

```sql
-- Clear existing data (CAREFUL!)
TRUNCATE TABLE feedback_summaries CASCADE;
TRUNCATE TABLE employees CASCADE;

-- Then re-run import
```

### Issue: "Foreign key violation on department_id"

**Cause:** Department doesn't exist.

**Solution:** The script creates departments first, so this shouldn't happen. If it does, run just the department section:

```sql
-- Extract and run only department INSERTs from the script
```

### Issue: "Cycle not found"

**Cause:** Feedback cycle was deleted.

**Solution:** Recreate the cycle:

```sql
INSERT INTO feedback_cycles (id, name, period_label, start_date, end_date, status, kpi_weight, feedback_weight, is_anonymous, allow_self_assessment, require_manager_review)
VALUES ('7b8c9563-60e3-4e11-9233-5ef98fec9dc8', 'Q1 2026 Performance Review', 'Q1 2026', '2026-01-01', '2026-03-31', 'completed', 70.00, 30.00, true, true, true);
```

## Next Steps After Import

1. ✅ Verify 80 employees imported
2. ✅ Check grade distribution matches expected
3. ✅ Test UI pages (Results, Test Data)
4. ✅ Export sample PDF reports
5. ⏭️ Phase 2: AI Enhancement (sentiment analysis, etc.)

## Support

If you encounter issues:
1. Check PostgreSQL / app logs
2. Verify table schema matches migration 003
3. Ensure cycle exists before importing summaries
4. Contact: Bang Ilham

---

**Generated:** 2026-05-06  
**Script:** `006_import_80_employees_with_feedback.sql`  
**Data Source:** `KPI_360_Combined_Dummy.xlsx`
