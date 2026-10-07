-- Rename Raw Material Master Data sidebar menus to Indonesian (id-ID)

UPDATE iam.menus
SET menu_name = 'Data Master', updated_at = now()
WHERE code = 'items.raw-material.master';

UPDATE iam.menus
SET menu_name = 'Satuan', updated_at = now()
WHERE code = 'items.raw-material.master.units';

UPDATE iam.menus
SET menu_name = 'Kategori', updated_at = now()
WHERE code = 'items.raw-material.master.categories';

UPDATE iam.menus
SET menu_name = 'Bahan Baku', updated_at = now()
WHERE code = 'items.raw-material.master.materials';

UPDATE iam.menus
SET menu_name = 'Bahan Baku', updated_at = now()
WHERE code = 'items.raw-material';
