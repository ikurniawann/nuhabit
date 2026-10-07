-- =============================================================================
-- Hapus tabel duplikat legacy (nama Indonesia / skema lama) yang sudah digantikan
-- oleh tabel kanonik berbahasa Inggris.
--
-- Kanonik yang dipakai aplikasi:
--   item.produk        → item.products
--   item.bahan_baku    → item.raw_materials
--   item.satuan        → item.units
--   manufacturing.bom  → manufacturing.bom_items
--   purchasing.goods_receipts / gr_items → purchasing.grn / grn_items
--   purchasing.po_details / po_items     → purchasing.purchase_order_items
--   purchasing.returns / qc_inspections    → purchase_returns / grn_qc_inspections
--   purchasing.supplier_price_list         → purchasing.supplier_price_lists
-- =============================================================================

-- Perbarui view yang masih join ke bahan_baku (jika ada di DB lama)
DROP VIEW IF EXISTS public.v_supplier_price_stats;
DROP VIEW IF EXISTS public.v_supplier_price_history;

CREATE VIEW public.v_supplier_price_history AS
 SELECT spl.id,
    spl.supplier_id,
    s.nama_supplier,
    s.kode AS supplier_kode,
    spl.bahan_baku_id,
    bb.nama AS bahan_baku_nama,
    bb.kode AS bahan_baku_kode,
    bb.kategori,
    spl.harga,
    spl.satuan_id,
    u.nama AS satuan_nama,
    spl.minimum_qty,
    spl.lead_time_days,
    spl.is_preferred,
    spl.berlaku_dari,
    spl.berlaku_sampai,
    spl.catatan,
    spl.is_active,
    spl.created_at,
    spl.updated_at,
    lag(spl.harga) OVER (PARTITION BY spl.supplier_id, spl.bahan_baku_id ORDER BY spl.berlaku_dari) AS previous_price,
        CASE
            WHEN lag(spl.harga) OVER (PARTITION BY spl.supplier_id, spl.bahan_baku_id ORDER BY spl.berlaku_dari) IS NULL THEN NULL::numeric
            ELSE round((spl.harga - lag(spl.harga) OVER (PARTITION BY spl.supplier_id, spl.bahan_baku_id ORDER BY spl.berlaku_dari)) / lag(spl.harga) OVER (PARTITION BY spl.supplier_id, spl.bahan_baku_id ORDER BY spl.berlaku_dari) * 100::numeric, 2)
        END AS price_change_percent
   FROM purchasing.supplier_price_lists spl
     LEFT JOIN purchasing.suppliers s ON spl.supplier_id = s.id
     LEFT JOIN item.raw_materials bb ON spl.bahan_baku_id = bb.id
     LEFT JOIN item.units u ON spl.satuan_id = u.id
  WHERE spl.is_active = true
  ORDER BY spl.supplier_id, spl.bahan_baku_id, spl.berlaku_dari DESC;

CREATE VIEW public.v_supplier_price_stats AS
 SELECT spl.supplier_id,
    s.nama_supplier,
    spl.bahan_baku_id,
    bb.nama AS bahan_baku_nama,
    count(*) AS total_price_changes,
    min(spl.harga) AS min_price,
    max(spl.harga) AS max_price,
    avg(spl.harga) AS avg_price,
    current_price.harga AS current_price,
    first_price.harga AS first_price,
        CASE
            WHEN first_price.harga > 0::numeric THEN round((current_price.harga - first_price.harga) / first_price.harga * 100::numeric, 2)
            ELSE 0::numeric
        END AS total_price_change_percent,
    min(spl.berlaku_dari) AS first_recorded_date,
    max(spl.berlaku_dari) AS last_updated_date
   FROM purchasing.supplier_price_lists spl
     LEFT JOIN purchasing.suppliers s ON spl.supplier_id = s.id
     LEFT JOIN item.raw_materials bb ON spl.bahan_baku_id = bb.id
     LEFT JOIN LATERAL ( SELECT supplier_price_lists.harga
           FROM purchasing.supplier_price_lists
          WHERE supplier_price_lists.supplier_id = spl.supplier_id AND supplier_price_lists.bahan_baku_id = spl.bahan_baku_id AND supplier_price_lists.is_active = true
          ORDER BY supplier_price_lists.berlaku_dari DESC
         LIMIT 1) current_price ON true
     LEFT JOIN LATERAL ( SELECT supplier_price_lists.harga
           FROM purchasing.supplier_price_lists
          WHERE supplier_price_lists.supplier_id = spl.supplier_id AND supplier_price_lists.bahan_baku_id = spl.bahan_baku_id
          ORDER BY supplier_price_lists.berlaku_dari
         LIMIT 1) first_price ON true
  WHERE spl.is_active = true
  GROUP BY spl.supplier_id, s.nama_supplier, spl.bahan_baku_id, bb.nama, current_price.harga, first_price.harga
  ORDER BY spl.supplier_id, spl.bahan_baku_id;

DO $$
DECLARE
    legacy_tables text[] := ARRAY[
        'purchasing.qc_inspections',
        'purchasing.returns',
        'purchasing.gr_items',
        'purchasing.goods_receipts',
        'purchasing.po_details',
        'purchasing.po_items',
        'purchasing.supplier_price_list',
        'manufacturing.bom',
        'item.bahan_baku',
        'item.produk',
        'item.satuan'
    ];
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY legacy_tables LOOP
        IF to_regclass(tbl) IS NOT NULL THEN
            EXECUTE format('DROP TABLE %s CASCADE', tbl);
            RAISE NOTICE 'Dropped legacy table %', tbl;
        END IF;
    END LOOP;
END $$;
