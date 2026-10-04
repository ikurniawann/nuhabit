-- Rename Settings billing menu to Tax & Service (UI focus).
-- Idempotent.

UPDATE iam.menus
SET menu_name = 'Tax & Service',
    is_active = true,
    is_visible = true,
    deleted_at = NULL,
    updated_at = now()
WHERE code = 'settings.billing';

-- Keep legacy POS placement retired
UPDATE iam.menus
SET is_active = false,
    is_visible = false,
    deleted_at = COALESCE(deleted_at, now()),
    updated_at = now()
WHERE code = 'pos.loyalty.billing-settings';
