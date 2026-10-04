-- ============================================
-- FIX: Create all missing views for Purchasing Module
-- Run this in admin database → SQL Editor
-- ============================================

-- ============================================
-- 1. FUNCTION: get_stock_status
-- ============================================
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

-- ============================================
-- 2. VIEW: v_raw_materials_stock
-- ============================================
DROP VIEW IF EXISTS v_raw_materials_stock CASCADE;

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

COMMENT ON VIEW v_raw_materials_stock IS 'View untuk menampilkan bahan baku dengan informasi stok real-time';

-- ============================================
-- 3. VIEW: v_products_cogs (Products dengan HPP)
-- ============================================
DROP VIEW IF EXISTS v_products_cogs CASCADE;

CREATE OR REPLACE VIEW v_products_cogs AS
SELECT 
    p.*,
    u.nama as satuan_nama,
    COALESCE(SUM(bi.qty_per_unit * rm.avg_cost), 0) as calculated_cogs,
    p.hpp as manual_hpp
FROM products p
LEFT JOIN units u ON p.satuan_id = u.id
LEFT JOIN bom_items bi ON p.id = bi.product_id AND bi.is_active = TRUE
LEFT JOIN raw_materials rm ON bi.raw_material_id = rm.id AND rm.is_active = TRUE
WHERE p.deleted_at IS NULL AND p.is_active = TRUE
GROUP BY p.id, u.nama, p.hpp;

COMMENT ON VIEW v_products_cogs IS 'View untuk menampilkan produk dengan perhitungan HPP dari BOM';

-- ============================================
-- 4. VIEW: v_purchase_orders (PO dengan stats)
-- ============================================
DROP VIEW IF EXISTS v_purchase_orders CASCADE;

CREATE OR REPLACE VIEW v_purchase_orders AS
SELECT 
    po.*,
    s.nama_supplier,
    s.kode as supplier_kode,
    COUNT(DISTINCT poi.id) as total_items,
    COALESCE(SUM(poi.qty_ordered), 0) as total_qty_ordered,
    COALESCE(SUM(poi.qty_received), 0) as total_qty_received,
    COALESCE(SUM(poi.subtotal), 0) as subtotal_amount,
    CASE 
        WHEN po.status = 'PENDING' THEN 'Menunggu Approval'
        WHEN po.status = 'APPROVED' THEN 'Disetujui'
        WHEN po.status = 'SENT' THEN 'Terkirim'
        WHEN po.status = 'PARTIAL' THEN 'Diterima Sebagian'
        WHEN po.status = 'RECEIVED' THEN 'Diterima Lengkap'
        WHEN po.status = 'CANCELLED' THEN 'Dibatalkan'
        ELSE po.status
    END as status_label
FROM purchase_orders po
LEFT JOIN suppliers s ON po.supplier_id = s.id
LEFT JOIN purchase_order_items poi ON po.id = poi.po_id AND poi.is_active = TRUE
WHERE po.deleted_at IS NULL
GROUP BY po.id, s.nama_supplier, s.kode;

COMMENT ON VIEW v_purchase_orders IS 'View untuk menampilkan PO dengan ringkasan statistik';

-- ============================================
-- 5. GRANT PERMISSIONS
-- ============================================
GRANT SELECT ON v_raw_materials_stock TO authenticated;
GRANT SELECT ON v_products_cogs TO authenticated;
GRANT SELECT ON v_purchase_orders TO authenticated;

-- ============================================
-- 6. VERIFICATION QUERIES
-- ============================================
SELECT 'v_raw_materials_stock' as view_name, COUNT(*) as row_count FROM v_raw_materials_stock
UNION ALL
SELECT 'v_products_cogs', COUNT(*) FROM v_products_cogs
UNION ALL
SELECT 'v_purchase_orders', COUNT(*) FROM v_purchase_orders;
