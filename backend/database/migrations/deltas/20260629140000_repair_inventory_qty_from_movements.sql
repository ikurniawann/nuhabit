-- =============================================================================
-- Repair inventory.qty_available yang rusak akibat string concatenation
-- (qty dari DB numeric dikonversi JS sebagai string: "10.0000" + 50 → "10.000050").
-- Recalculate dari inventory_movements per raw_material + warehouse.
-- =============================================================================

UPDATE inventory.inventory inv
SET qty_available = sub.correct_qty,
    updated_at = NOW()
FROM (
  SELECT
    im.raw_material_id,
    im.warehouse_id,
    COALESCE(
      SUM(
        CASE
          WHEN im.tipe = 'in' THEN im.jumlah
          WHEN im.tipe = 'out' THEN -im.jumlah
          WHEN im.tipe = 'return' THEN im.jumlah
          ELSE 0
        END
      ),
      0
    ) AS correct_qty
  FROM inventory.inventory_movements im
  WHERE im.is_active IS DISTINCT FROM false
  GROUP BY im.raw_material_id, im.warehouse_id
) sub
WHERE inv.raw_material_id = sub.raw_material_id
  AND COALESCE(inv.warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid)
    = COALESCE(sub.warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid)
  AND inv.is_active = true
  AND inv.qty_available IS DISTINCT FROM sub.correct_qty;

-- Perbaiki qty_after movement GRN yang salah (opsional, untuk audit trail)
UPDATE inventory.inventory_movements im
SET qty_after = im.qty_before + im.jumlah
WHERE im.reference_type = 'grn'
  AND im.tipe = 'in'
  AND im.qty_after IS DISTINCT FROM (im.qty_before + im.jumlah);
