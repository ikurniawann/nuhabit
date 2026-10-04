-- Disable NIP trigger yang menyebabkan duplicate
-- Run ini di admin database > SQL Editor

-- Drop trigger yang overwrite NIP
DROP TRIGGER IF EXISTS employees_set_nip_before_insert ON employees;

-- Optional: Drop function juga kalau tidak dipakai lagi
-- DROP FUNCTION IF EXISTS set_employee_nip();
-- DROP FUNCTION IF EXISTS generate_nip();

-- Verify trigger sudah di-drop
SELECT tgname, tgrelid::regclass 
FROM pg_trigger 
WHERE tgname = 'employees_set_nip_before_insert';
-- Should return 0 rows
