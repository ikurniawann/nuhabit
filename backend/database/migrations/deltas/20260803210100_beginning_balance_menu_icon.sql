-- Fix Beginning Balance menu icon to a known NavIconName
UPDATE iam.menus
SET icon = 'banknotes',
    updated_at = now()
WHERE code = 'accounting.beginning-balance';
