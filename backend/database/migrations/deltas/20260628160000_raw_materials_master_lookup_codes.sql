-- Izinkan kode kategori & penyimpanan dari master data (bukan enum lama)

ALTER TABLE item.raw_materials
  DROP CONSTRAINT IF EXISTS raw_materials_kategori_check;

ALTER TABLE item.raw_materials
  DROP CONSTRAINT IF EXISTS raw_materials_storage_condition_check;
