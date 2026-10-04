-- EPIC-024 — layar customer pindah ke /pos/customer-display (di luar
-- layout dashboard) supaya fullscreen murni tanpa sidebar/navbar.
UPDATE iam.menus
SET route_path = '/pos/customer-display', updated_at = now()
WHERE code = 'pos.operations.customer-display';
