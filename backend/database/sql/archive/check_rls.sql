-- Cek RLS policy untuk feedback_summaries
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'feedback_summaries';

-- Cek apakah RLS enabled
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname = 'feedback_summaries';

-- Test query langsung
SELECT 
  fs.id,
  fs.final_score,
  fs.final_grade,
  e.full_name,
  e.nip,
  d.name as department_name
FROM feedback_summaries fs
JOIN employees e ON fs.employee_id = e.id
LEFT JOIN departments d ON e.department_id = d.id
LIMIT 10;
