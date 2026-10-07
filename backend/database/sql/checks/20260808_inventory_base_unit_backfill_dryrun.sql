-- =============================================================================
-- DRY RUN — Backfill satuan dasar inventory untuk posting GRN lama
--
-- Konteks: inventory.qty_available / unit_cost adalah satuan dasar bahan baku
-- (satuan kecil bila ada, selain itu satuan besar). Posting GRN sebelum perbaikan
-- menulis qty dan harga dalam satuan transaksi PO/GRN tanpa konversi.
--
-- Script ini HANYA membaca. Jalankan dan periksa hasilnya sebelum menjalankan
-- migration database/migrations/deltas/20260808030000_inventory_base_unit_backfill.sql
--
-- Ubah cutoff di bawah ke waktu deploy perbaikan konversi GRN.
-- =============================================================================

\set cutoff '2026-08-08 00:00:00+07'

WITH cutoff AS (
  SELECT :'cutoff'::timestamptz AS ts
),
grn_movements AS (
  SELECT
    m.id AS movement_id,
    m.raw_material_id,
    m.reference_id AS grn_id,
    m.jumlah,
    m.unit_cost,
    m.created_at,
    rm.kode,
    rm.nama,
    rm.satuan_kecil_id,
    rm.satuan_besar_id,
    COALESCE(NULLIF(rm.konversi_factor, 0), 1) AS konversi_factor,
    gi.satuan_id AS document_satuan_id,
    conv.qty_in_base_unit
  FROM inventory.inventory_movements m
  JOIN item.raw_materials rm ON rm.id = m.raw_material_id
  CROSS JOIN cutoff c
  LEFT JOIN purchasing.grn_items gi
    ON gi.grn_id = m.reference_id
   AND gi.raw_material_id = m.raw_material_id
   AND gi.is_active = true
  LEFT JOIN item.raw_material_unit_conversions conv
    ON conv.raw_material_id = m.raw_material_id
   AND conv.satuan_id = gi.satuan_id
   AND conv.is_active = true
  WHERE m.tipe = 'in'
    AND m.reference_type = 'grn'
    AND m.created_at < c.ts
    AND rm.satuan_kecil_id IS NOT NULL
),
scaled AS (
  SELECT
    gm.*,
    CASE
      WHEN COALESCE(gm.qty_in_base_unit, 0) > 0 THEN gm.qty_in_base_unit
      WHEN gm.document_satuan_id = gm.satuan_kecil_id THEN 1
      ELSE gm.konversi_factor
    END AS base_unit_factor
  FROM grn_movements gm
)
SELECT
  s.kode,
  s.nama,
  s.konversi_factor,
  count(*) AS movement_count,
  sum(s.jumlah) AS qty_tercatat_sekarang,
  sum(s.jumlah * s.base_unit_factor) AS qty_setelah_konversi,
  sum(s.jumlah * (s.base_unit_factor - 1)) AS selisih_qty,
  min(s.base_unit_factor) AS faktor_min,
  max(s.base_unit_factor) AS faktor_max,
  i.qty_available AS stok_inventory_sekarang,
  i.qty_available + sum(s.jumlah * (s.base_unit_factor - 1)) AS stok_inventory_setelah,
  i.unit_cost AS unit_cost_sekarang
FROM scaled s
LEFT JOIN inventory.inventory i
  ON i.raw_material_id = s.raw_material_id
 AND i.is_active = true
GROUP BY s.kode, s.nama, s.konversi_factor, i.qty_available, i.unit_cost
HAVING sum(s.jumlah * (s.base_unit_factor - 1)) <> 0
ORDER BY abs(sum(s.jumlah * (s.base_unit_factor - 1))) DESC;

-- Pergerakan GRN yang tidak bisa dipetakan ke grn_items (faktor jatuh ke konversi_factor).
-- Periksa manual bila jumlahnya banyak.
WITH cutoff AS (
  SELECT :'cutoff'::timestamptz AS ts
)
SELECT
  m.id AS movement_id,
  m.created_at,
  m.reference_number,
  rm.kode,
  m.jumlah,
  m.unit_cost
FROM inventory.inventory_movements m
JOIN item.raw_materials rm ON rm.id = m.raw_material_id
CROSS JOIN cutoff c
LEFT JOIN purchasing.grn_items gi
  ON gi.grn_id = m.reference_id
 AND gi.raw_material_id = m.raw_material_id
 AND gi.is_active = true
WHERE m.tipe = 'in'
  AND m.reference_type = 'grn'
  AND m.created_at < c.ts
  AND rm.satuan_kecil_id IS NOT NULL
  AND gi.id IS NULL
ORDER BY m.created_at DESC;
