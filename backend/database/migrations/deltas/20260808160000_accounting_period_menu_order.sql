-- Period & Closing: Fiscal Years before Beginning Balance
UPDATE iam.menus
SET order_number = 10, updated_at = now()
WHERE code = 'accounting.period.fiscal-years';

UPDATE iam.menus
SET order_number = 20, updated_at = now()
WHERE code = 'accounting.period.beginning-balance';
