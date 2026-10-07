-- POS ops menus open tablet/immersive shell by default (no dashboard sidebar).
-- Cashier → /dashboard/pos/tablet ; Restaurant → /dashboard/pos/restaurant-tablet

UPDATE iam.menus
SET route_path = '/dashboard/pos/tablet',
    updated_at = now()
WHERE code = 'pos.operations.cashier'
  AND (route_path IS DISTINCT FROM '/dashboard/pos/tablet');

UPDATE iam.menus
SET route_path = '/dashboard/pos/restaurant-tablet',
    updated_at = now()
WHERE code = 'pos.operations.restaurant'
  AND (route_path IS DISTINCT FROM '/dashboard/pos/restaurant-tablet');
