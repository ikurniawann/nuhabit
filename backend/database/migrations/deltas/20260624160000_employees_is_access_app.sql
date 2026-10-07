-- Flag akses aplikasi pada karyawan (terpisah dari is_active kepegawaian).
-- Nama tabel "bare": resolve via search_path (public sebelum pindah, hris sesudah).
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS is_access_app boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN employees.is_access_app IS
  'Jika true, karyawan punya akun login (users + auth) dengan role & password.';

-- Sinkronkan flag untuk karyawan yang sudah punya user_id
UPDATE employees
SET is_access_app = true
WHERE user_id IS NOT NULL AND is_access_app = false;
