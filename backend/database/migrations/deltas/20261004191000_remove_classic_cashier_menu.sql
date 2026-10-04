-- POS Classic dihapus (2026-10-04): kasir utama dipertahankan. Route lama
-- /dashboard/pos/classic kini redirect ke kasir utama, jadi menunya ikut
-- di-soft-delete (pola yang sama dengan seeder iam-menus). Idempoten.

UPDATE iam.role_menu_permissions rmp
SET is_active = false, updated_at = now()
FROM iam.menus m
WHERE m.id = rmp.menu_id
  AND m.code = 'pos.operations.cashier-classic'
  AND rmp.is_active;

UPDATE iam.menus
SET is_active = false, is_visible = false, deleted_at = now(), updated_at = now()
WHERE code = 'pos.operations.cashier-classic'
  AND deleted_at IS NULL;
