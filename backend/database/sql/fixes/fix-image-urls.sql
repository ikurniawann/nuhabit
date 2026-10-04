-- Fix image URLs for products
UPDATE pos_products SET image_url = '/products/kentang-goreng.png' WHERE sku = 'KGH-007';

-- Verify
SELECT sku, name, image_url FROM pos_products WHERE sku = 'KGH-007';
