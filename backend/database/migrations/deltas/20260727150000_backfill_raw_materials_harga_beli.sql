-- =============================================================================
-- Backfill harga_beli bahan baku SULU + sync inventory.unit_cost kosong
--
-- Estimated COGS (v_products_cogs) memakai v_raw_materials_stock.avg_cost, yang
-- fallback ke harga_beli bila inventory.unit_cost = 0. Data master SULU masuk
-- tanpa harga, sehingga HPP estimasi tampil 0 meski BOM sudah ada.
--
-- harga_beli = perkiraan harga beli per satuan besar (IDR).
-- Idempotent: hanya mengisi baris dengan harga_beli = 0.
-- =============================================================================

UPDATE item.raw_materials rm
SET harga_beli = v.harga,
    updated_at = now()
FROM (
  VALUES
    -- BAKERY (per KG)
    ('BB-BAKERY-001', 185000::numeric),
    ('BB-BAKERY-002', 280000),
    ('BB-BAKERY-003', 18000),
    ('BB-BAKERY-004', 22000),
    ('BB-BAKERY-005', 18000),
    ('BB-BAKERY-006', 16000),
    ('BB-BAKERY-007', 15000),
    ('BB-BAKERY-008', 195000),
    ('BB-BAKERY-009', 120000),
    ('BB-BAKERY-010', 25000),

    -- BEKU
    ('BB-BEKU-001', 18000),   -- pack udon
    ('BB-BEKU-002', 65000),   -- botol gochujang
    ('BB-BEKU-003', 95000),
    ('BB-BEKU-004', 110000),
    ('BB-BEKU-005', 85000),
    ('BB-BEKU-006', 75000),
    ('BB-BEKU-007', 140000),

    -- BUMBU (per KG / pack)
    ('BB-BUMBU-001', 45000),
    ('BB-BUMBU-002', 180000),
    ('BB-BUMBU-003', 8000),    -- Garam Refina
    ('BB-BUMBU-004', 22000),
    ('BB-BUMBU-005', 16000),   -- Gula Putih
    ('BB-BUMBU-006', 250000),
    ('BB-BUMBU-007', 160000),
    ('BB-BUMBU-008', 55000),
    ('BB-BUMBU-009', 45000),   -- pack togarashi
    ('BB-BUMBU-010', 220000),
    ('BB-BUMBU-011', 95000),
    ('BB-BUMBU-012', 48000),

    -- DAGING
    ('BB-DAGING-001', 48000),
    ('BB-DAGING-002', 125000),
    ('BB-DAGING-003', 185000),
    ('BB-DAGING-004', 28000),
    ('BB-DAGING-005', 95000),  -- pack smoked duck
    ('BB-DAGING-006', 22000),
    ('BB-DAGING-007', 35000),
    ('BB-DAGING-008', 30000),
    ('BB-DAGING-009', 175000),
    ('BB-DAGING-010', 52000),  -- Paha Ayam Fillet
    ('BB-DAGING-011', 42000),  -- Sayap Ayam
    ('BB-DAGING-012', 165000),
    ('BB-DAGING-013', 2000),   -- Telur curah / butir
    ('BB-DAGING-014', 2500),

    -- DAIRY
    ('BB-DAIRY-001', 145000),
    ('BB-DAIRY-002', 120000),
    ('BB-DAIRY-003', 18000),   -- Fresh Milk / L
    ('BB-DAIRY-004', 85000),
    ('BB-DAIRY-005', 280000),
    ('BB-DAIRY-006', 98000),
    ('BB-DAIRY-007', 95000),
    ('BB-DAIRY-008', 90000),
    ('BB-DAIRY-009', 110000),

    -- KEMASAN
    ('BB-KEMASAN-001', 35000),
    ('BB-KEMASAN-002', 28000),
    ('BB-KEMASAN-003', 22000),
    ('BB-KEMASAN-004', 28000),
    ('BB-KEMASAN-005', 45000),
    ('BB-KEMASAN-006', 38000),
    ('BB-KEMASAN-007', 42000),

    -- KERING
    ('BB-KERING-001', 165000),
    ('BB-KERING-002', 85000),  -- Biji Wijen
    ('BB-KERING-003', 95000),
    ('BB-KERING-004', 35000),  -- pack chili flakes
    ('BB-KERING-005', 120000),
    ('BB-KERING-006', 280000),
    ('BB-KERING-007', 450000), -- Hojicha Powder
    ('BB-KERING-008', 22000),
    ('BB-KERING-009', 180000),
    ('BB-KERING-010', 28000),  -- Japonica Rice
    ('BB-KERING-011', 650000), -- Matcha Powder
    ('BB-KERING-012', 210000),
    ('BB-KERING-013', 45000),
    ('BB-KERING-014', 280000),
    ('BB-KERING-015', 55000),

    -- LAIN / WIP proxy
    ('BB-LAIN-001', 95000),
    ('WPPRD20260726001', 8000), -- Americano WIP / cup

    -- MINUMAN
    ('BB-MINUMAN-001', 5000),  -- Air / L (fallback; inventory existing unit_cost tetap)
    ('BB-MINUMAN-002', 3000),

    -- NONPANG
    ('BB-NONPANG-001', 25000),
    ('BB-NONPANG-002', 18000),
    ('BB-NONPANG-003', 5000),

    -- OIL
    ('BB-OIL-001', 20000),     -- Minyak Goreng / L
    ('BB-OIL-002', 75000),     -- botol minyak wijen

    -- SAUS
    ('BB-SAUS-001', 55000),
    ('BB-SAUS-002', 42000),
    ('BB-SAUS-003', 48000),
    ('BB-SAUS-004', 28000),
    ('BB-SAUS-005', 85000),    -- Shoyu / L
    ('BB-SAUS-006', 65000),
    ('BB-SAUS-007', 120000),   -- Madu
    ('BB-SAUS-008', 35000),    -- Chili sauce

    -- SAYUR
    ('BB-SAYUR-001', 45000),
    ('BB-SAYUR-002', 25000),   -- Bawang Bombay
    ('BB-SAYUR-003', 40000),   -- Bawang putih
    ('BB-SAYUR-004', 35000),
    ('BB-SAYUR-005', 18000),
    ('BB-SAYUR-006', 22000),
    ('BB-SAYUR-007', 28000),
    ('BB-SAYUR-008', 95000),
    ('BB-SAYUR-009', 32000),
    ('BB-SAYUR-010', 65000),
    ('BB-SAYUR-011', 28000),
    ('BB-SAYUR-012', 185000),
    ('BB-SAYUR-013', 12000),   -- pieces kol
    ('BB-SAYUR-014', 15000),
    ('BB-SAYUR-015', 35000),
    ('BB-SAYUR-016', 55000),
    ('BB-SAYUR-017', 42000),
    ('BB-SAYUR-018', 65000),
    ('BB-SAYUR-019', 65000),
    ('BB-SAYUR-020', 10000),
    ('BB-SAYUR-021', 14000),

    -- SEAFOOD
    ('BB-SEAFOOD-001', 420000),
    ('BB-SEAFOOD-002', 380000),
    ('BB-SEAFOOD-003', 450000),
    ('BB-SEAFOOD-004', 35000),
    ('BB-SEAFOOD-005', 55000),
    ('BB-SEAFOOD-006', 95000), -- pieces salmon
    ('BB-SEAFOOD-007', 280000),
    ('BB-SEAFOOD-008', 85000),
    ('BB-SEAFOOD-009', 320000),
    ('BB-SEAFOOD-010', 95000),
    ('BB-SEAFOOD-011', 65000)
) AS v(kode, harga)
WHERE rm.kode = v.kode
  AND rm.deleted_at IS NULL
  AND COALESCE(rm.harga_beli, 0) = 0;

-- Sync stok: isi unit_cost kosong dari harga_beli (satuan besar, sama seperti fallback view)
UPDATE inventory.inventory i
SET unit_cost = rm.harga_beli,
    updated_at = now()
FROM item.raw_materials rm
WHERE i.raw_material_id = rm.id
  AND i.is_active = true
  AND COALESCE(i.unit_cost, 0) = 0
  AND COALESCE(rm.harga_beli, 0) > 0;
