-- The default storefront name was seeded in Indonesian. Preserve renamed stores.
UPDATE shop.storefronts
SET name = 'Online Store', description = 'NüHabit apparel and equipment', updated_at = now()
WHERE slug = 'toko'
  AND name = 'Toko Online'
  AND description = 'Storefront merchandise default';
