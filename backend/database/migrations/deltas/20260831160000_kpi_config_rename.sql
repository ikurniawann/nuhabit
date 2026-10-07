-- Ganti nama menu "Konfigurasi KPI" → "Konfigurasi KPI Department"
-- (permintaan owner 2026-08-31).
UPDATE iam.menus SET menu_name = 'Konfigurasi KPI Department', updated_at = now()
WHERE code = 'hris.performance.kpi-config';
