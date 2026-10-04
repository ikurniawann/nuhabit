-- Move ARK & XP (loyalty-settings) under POS Pengaturan.
-- Idempotent.

UPDATE iam.menus child
SET parent_id = parent.id,
    menu_name = 'ARK & XP',
    order_number = 20,
    is_active = true,
    is_visible = true,
    deleted_at = NULL,
    updated_at = now()
FROM iam.menus parent
WHERE child.code = 'pos.loyalty.settings'
  AND parent.code = 'pos.settings';

-- Keep Pengaturan children ordered: Metode Bayar → ARK & XP → Printer
UPDATE iam.menus SET order_number = 10, updated_at = now()
WHERE code = 'pos.loyalty.payment-methods';
UPDATE iam.menus SET order_number = 30, updated_at = now()
WHERE code = 'pos.kitchen.printer-settings';
