-- Rename Settings → Billing Config menu to Indonesian
UPDATE iam.menus
SET menu_name = 'Konfigurasi Billing',
    updated_at = now()
WHERE code = 'settings.billing';
