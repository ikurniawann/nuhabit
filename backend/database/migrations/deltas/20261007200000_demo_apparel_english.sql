-- English copy for the four demo merchandise records used by the public shop.
-- Fixed fixture IDs and old-value guards leave operational catalog edits alone.
UPDATE pos.pos_categories SET name = 'Tops', updated_at = now()
WHERE id = 'a1000000-0000-4000-8000-000000000001' AND name = 'Atasan';
UPDATE pos.pos_categories SET name = 'Accessories', updated_at = now()
WHERE id = 'a1000000-0000-4000-8000-000000000002' AND name = 'Aksesori';

UPDATE pos.pos_products SET name = 'HYROX Training Tee', updated_at = now()
WHERE id = 'b1000000-0000-4000-8000-000000000001' AND name = 'Kaos HYROX Training';
UPDATE pos.pos_products SET description = 'Dry-fit training tee.', updated_at = now()
WHERE id = 'b1000000-0000-4000-8000-000000000001' AND description = 'Kaos latihan dry-fit.';
UPDATE pos.pos_products SET description = 'Heavyweight cotton hoodie, available for pre-order.', updated_at = now()
WHERE id = 'b1000000-0000-4000-8000-000000000002' AND description = 'Hoodie katun tebal, pre-order.';
UPDATE pos.pos_products SET name = 'Running Cap', updated_at = now()
WHERE id = 'b1000000-0000-4000-8000-000000000003' AND name = 'Topi Lari';
UPDATE pos.pos_products SET description = 'Lightweight running cap.', updated_at = now()
WHERE id = 'b1000000-0000-4000-8000-000000000003' AND description = 'Topi ringan.';
UPDATE pos.pos_products SET name = '1L Water Bottle', updated_at = now()
WHERE id = 'b1000000-0000-4000-8000-000000000004' AND name = 'Botol 1L';
