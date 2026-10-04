-- Drop storage_conditions master table; keep enum on raw_materials.storage_condition.

UPDATE item.raw_materials
SET storage_condition = 'KHUSUS'
WHERE storage_condition IS NOT NULL
  AND storage_condition NOT IN ('SUHU_RUANG', 'DINGIN', 'BEKU', 'KHUSUS');

DROP TABLE IF EXISTS item.storage_conditions CASCADE;

ALTER TABLE item.raw_materials
  DROP CONSTRAINT IF EXISTS raw_materials_storage_condition_check;

ALTER TABLE item.raw_materials
  ADD CONSTRAINT raw_materials_storage_condition_check
  CHECK (
    storage_condition IS NULL
    OR storage_condition IN ('SUHU_RUANG', 'DINGIN', 'BEKU', 'KHUSUS')
  );
