-- INSIDEN 19 Jul 21:17 WIB: seeder database/seeders/iam-menus.sql dijalankan
-- dengan daftar-putih usang — langkah "retire"-nya men-soft-delete SEMUA menu
-- yang tidak ada di daftar, menyapu 16 menu dari epic 005-012 (ESS, KPI,
-- Lembur, Pinjaman, Slip Gaji, Pengumuman, Live Monitoring, CRM Settings,
-- Laporan CRM, WhatsApp Gateway).
--
-- Migrasi ini memulihkan menu + grant-nya. Perbaikan akar masalah (daftar
-- putih seeder diperbarui) dilakukan di file seeder pada commit yang sama.

WITH korban(code) AS (
  VALUES
    ('ess.home'), ('ess.overtime'), ('ess.loans'), ('ess.payroll'),
    ('ess.kpi'), ('ess.announcements'),
    ('hris.kepegawaian.overtime'), ('hris.kepegawaian.loans'),
    ('hris.kepegawaian.announcements'),
    ('hris.performance.kpi-scorecard'), ('hris.recruitment.live-monitoring'),
    ('crm.settings'), ('crm.settings.config'),
    ('crm.reports'), ('crm.reports.overview'),
    ('settings.wa_gateway')
)
UPDATE iam.menus m
   SET deleted_at = NULL, deleted_by = NULL,
       is_active = true, is_visible = true, updated_at = now()
  FROM korban k
 WHERE m.code = k.code;

-- Grant peran ikut dinonaktifkan seeder — hidupkan kembali.
WITH korban(code) AS (
  VALUES
    ('ess.home'), ('ess.overtime'), ('ess.loans'), ('ess.payroll'),
    ('ess.kpi'), ('ess.announcements'),
    ('hris.kepegawaian.overtime'), ('hris.kepegawaian.loans'),
    ('hris.kepegawaian.announcements'),
    ('hris.performance.kpi-scorecard'), ('hris.recruitment.live-monitoring'),
    ('crm.settings'), ('crm.settings.config'),
    ('crm.reports'), ('crm.reports.overview'),
    ('settings.wa_gateway')
)
UPDATE iam.role_menu_permissions p
   SET is_active = true, updated_at = now()
  FROM iam.menus m, korban k
 WHERE p.menu_id = m.id AND m.code = k.code;
