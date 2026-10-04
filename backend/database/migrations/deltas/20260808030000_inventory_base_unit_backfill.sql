-- =============================================================================
-- Backfill satuan dasar inventory untuk posting GRN sebelum perbaikan konversi
--
-- inventory.qty_available dan unit_cost dicatat dalam satuan dasar bahan baku
-- (satuan kecil bila ada, selain itu satuan besar). Posting GRN lama menulis qty
-- dan harga dalam satuan transaksi PO/GRN tanpa konversi, sehingga stok bahan
-- baku bersatuan kecil tercatat terlalu kecil dan unit cost terlalu besar.
--
-- Migration ini mengonversi pergerakan GRN lama beserta saldo inventory-nya.
-- JALANKAN DRY RUN LEBIH DULU:
--   sql/checks/20260808_inventory_base_unit_backfill_dryrun.sql
--
-- Cakupan: hanya bahan baku yang punya satuan kecil dan pergerakan bertipe
-- reference_type = 'grn' sebelum cutoff. Impor stok awal sudah satuan dasar.
-- Idempotent: baris yang sudah dikonversi ditandai lewat tabel jejak di bawah.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS inventory.inventory_base_unit_backfill (
    movement_id        uuid PRIMARY KEY,
    raw_material_id    uuid NOT NULL,
    base_unit_factor   numeric(15,6) NOT NULL,
    qty_before_fix     numeric(15,3) NOT NULL,
    unit_cost_before   numeric(15,2),
    converted_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory.inventory_base_unit_backfill IS
  'Jejak konversi pergerakan GRN lama ke satuan dasar; mencegah konversi ganda.';

-- Cutoff = waktu deploy perbaikan konversi GRN. Sesuaikan bila deploy berbeda.
CREATE TEMP TABLE tmp_base_unit_cutoff AS
SELECT '2026-08-08 00:00:00+07'::timestamptz AS ts;

CREATE TEMP TABLE tmp_grn_movement_factors AS
SELECT
  m.id AS movement_id,
  m.raw_material_id,
  m.jumlah,
  m.unit_cost,
  CASE
    WHEN COALESCE(conv.qty_in_base_unit, 0) > 0 THEN conv.qty_in_base_unit
    WHEN gi.satuan_id = rm.satuan_kecil_id THEN 1
    ELSE COALESCE(NULLIF(rm.konversi_factor, 0), 1)
  END AS base_unit_factor
FROM inventory.inventory_movements m
JOIN item.raw_materials rm ON rm.id = m.raw_material_id
CROSS JOIN tmp_base_unit_cutoff c
LEFT JOIN purchasing.grn_items gi
  ON gi.grn_id = m.reference_id
 AND gi.raw_material_id = m.raw_material_id
 AND gi.is_active = true
LEFT JOIN item.raw_material_unit_conversions conv
  ON conv.raw_material_id = m.raw_material_id
 AND conv.satuan_id = gi.satuan_id
 AND conv.is_active = true
LEFT JOIN inventory.inventory_base_unit_backfill done ON done.movement_id = m.id
WHERE m.tipe = 'in'
  AND m.reference_type = 'grn'
  AND m.created_at < c.ts
  AND rm.satuan_kecil_id IS NOT NULL
  AND done.movement_id IS NULL;

DELETE FROM tmp_grn_movement_factors WHERE base_unit_factor = 1;

-- 1. Catat jejak sebelum data diubah.
INSERT INTO inventory.inventory_base_unit_backfill (
  movement_id, raw_material_id, base_unit_factor, qty_before_fix, unit_cost_before
)
SELECT movement_id, raw_material_id, base_unit_factor, jumlah, unit_cost
FROM tmp_grn_movement_factors;

-- 2. Geser saldo inventory sebesar selisih konversi pergerakan GRN.
--    unit_cost dihitung ulang sebagai total biaya GRN dibagi qty satuan dasar.
--    Stok dari impor (sudah satuan dasar) tidak ikut ditimbang, jadi angkanya
--    perkiraan bila satu bahan baku punya stok campuran GRN + impor.
UPDATE inventory.inventory i
SET qty_available = GREATEST(0, i.qty_available + d.qty_delta),
    unit_cost = CASE
      WHEN d.cost_weight > 0 THEN d.new_unit_cost
      ELSE i.unit_cost
    END,
    updated_at = now()
FROM (
  SELECT
    raw_material_id,
    sum(jumlah * (base_unit_factor - 1)) AS qty_delta,
    sum(jumlah * base_unit_factor) AS cost_weight,
    CASE
      WHEN sum(jumlah * base_unit_factor) > 0
        THEN sum(jumlah * unit_cost) / sum(jumlah * base_unit_factor)
      ELSE NULL
    END AS new_unit_cost
  FROM tmp_grn_movement_factors
  GROUP BY raw_material_id
) d
WHERE i.raw_material_id = d.raw_material_id
  AND i.is_active = true;

-- 3. Konversi baris pergerakan agar riwayat harga per satuan dasar konsisten.
--    total_cost tidak diubah: jumlah naik dan unit_cost turun dengan faktor sama.
--    qty_before/qty_after ikut diskalakan sebagai perkiraan; rantai saldo lama
--    yang bercampur pergerakan non-GRN tidak direkonstruksi ulang.
UPDATE inventory.inventory_movements m
SET jumlah = m.jumlah * f.base_unit_factor,
    qty_before = m.qty_before * f.base_unit_factor,
    qty_after = m.qty_after * f.base_unit_factor,
    unit_cost = m.unit_cost / f.base_unit_factor,
    updated_at = now()
FROM tmp_grn_movement_factors f
WHERE m.id = f.movement_id
  AND f.base_unit_factor > 0;

DROP TABLE tmp_grn_movement_factors;
DROP TABLE tmp_base_unit_cutoff;

COMMIT;
