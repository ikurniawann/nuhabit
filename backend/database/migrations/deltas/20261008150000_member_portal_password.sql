-- Login portal member memakai password, bukan hanya username.
--
-- `/api/member-portal/login` sebelumnya mengabaikan password (baris password
-- dikomentari) sehingga sesi diberikan hanya dengan username yang diketahui.
-- Kolom ini menyimpan hash bcrypt (format `$2b$10$...`, dihitung oleh
-- `@/lib/auth/password`) yang wajib diverifikasi route login.
--
-- Nullable dengan sengaja: member lama (enroll di kasir / card) tetap sah.
-- Member tanpa hash TIDAK bisa login password dan dijawab 403 dengan pesan
-- yang bisa ditindaklanjuti; seeder `member-portal-passwords.js` mengisi
-- password member demo secara idempoten (hanya yang masih NULL).
ALTER TABLE pos.pos_customers
  ADD COLUMN IF NOT EXISTS password_hash text;
