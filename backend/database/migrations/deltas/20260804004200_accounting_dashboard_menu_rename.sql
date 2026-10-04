-- Rename Reports hub to Accounting Dashboard
UPDATE iam.menus
SET menu_name = 'Dashboard',
    updated_at = now()
WHERE code = 'accounting.reports'
  AND deleted_at IS NULL;

UPDATE iam.menus
SET menu_name = 'Overview',
    updated_at = now()
WHERE code = 'accounting.reports.overview'
  AND deleted_at IS NULL;
