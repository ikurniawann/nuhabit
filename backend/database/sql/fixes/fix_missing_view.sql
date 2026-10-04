-- ============================================
-- FIX: Create v_raw_materials_stock view
-- Run this in admin database → SQL Editor
-- ============================================

-- Ensure function exists first
CREATE OR REPLACE FUNCTION get_stock_status(
    p_onhand DECIMAL,
    p_minimum DECIMAL
) RETURNS TEXT AS $$
BEGIN
    IF p_onhand <= 0 THEN
        RETURN 'HABIS';
    ELSIF p_onhand <= p_minimum THEN
        RETURN 'MENIPIS';
    ELSE
        RETURN 'AMAN';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Drop existing view if exists (to recreate with latest structure)
DROP VIEW IF EXISTS v_raw_materials_stock CASCADE;

-- Create view: Raw Materials dengan info stok
CREATE OR REPLACE VIEW v_raw_materials_stock AS
SELECT 
    rm.id,
    rm.kode,
    rm.nama,
    rm.kategori,
    rm.deskripsi,
    rm.satuan_besar_id,
    rm.satuan_kecil_id,
    rm.konversi_factor,
    rm.stok_minimum,
    rm.stok_maximum,
    rm.shelf_life_days,
    rm.storage_condition,
    rm.is_active,
    rm.created_at,
    rm.updated_at,
    rm.deleted_at,
    u1.nama as satuan_besar_nama,
    u2.nama as satuan_kecil_nama,
    COALESCE(i.qty_onhand, 0) as qty_onhand,
    COALESCE(i.qty_reserved, 0) as qty_reserved,
    COALESCE(i.qty_on_order, 0) as qty_on_order,
    COALESCE(i.avg_cost, 0) as avg_cost,
    get_stock_status(COALESCE(i.qty_onhand, 0), rm.stok_minimum) as status_stok
FROM raw_materials rm
LEFT JOIN units u1 ON rm.satuan_besar_id = u1.id
LEFT JOIN units u2 ON rm.satuan_kecil_id = u2.id
LEFT JOIN inventory i ON rm.id = i.raw_material_id
WHERE rm.deleted_at IS NULL AND rm.is_active = TRUE;

-- Add comment for clarity
COMMENT ON VIEW v_raw_materials_stock IS 'View untuk menampilkan bahan baku dengan informasi stok real-time';

-- Grant permissions
GRANT SELECT ON v_raw_materials_stock TO authenticated;

-- Verify
SELECT COUNT(*) as total_bahan_baku FROM v_raw_materials_stock;
