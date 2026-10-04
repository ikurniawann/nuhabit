-- Station KDS/POS pada master Items (item.products).
-- User memilih kitchen/bar/bakery/dst di form insert/edit; sync ke pos_products.station.

ALTER TABLE item.products
  ADD COLUMN IF NOT EXISTS station text NOT NULL DEFAULT 'kitchen';

ALTER TABLE item.products
  DROP CONSTRAINT IF EXISTS products_station_check;

ALTER TABLE item.products
  ADD CONSTRAINT products_station_check
  CHECK (
    station = ANY (
      ARRAY[
        'kitchen'::text,
        'bar'::text,
        'bakery'::text,
        'dessert'::text,
        'merchandise'::text,
        'photobooth'::text
      ]
    )
  );

COMMENT ON COLUMN item.products.station IS
  'KDS/POS station: kitchen, bar, bakery, dessert, merchandise, photobooth.';

UPDATE item.products
SET station = CASE
  WHEN kategori ~* 'coffee|tea|beverage|juice|mocktail|minuman|drink|bar' THEN 'bar'
  WHEN kategori ~* 'dessert|roti|cake|bakery|pastry' THEN 'bakery'
  ELSE COALESCE(NULLIF(station, ''), 'kitchen')
END
WHERE deleted_at IS NULL
  AND station = 'kitchen';

CREATE OR REPLACE VIEW "public"."v_products_cogs" AS
 SELECT p.id,
    p.kode,
    p.nama,
    p.deskripsi,
    p.kategori,
    p.satuan_id,
    p.harga_jual,
    p.is_active,
    p.created_at,
    p.updated_at,
    p.created_by,
    p.updated_by,
    p.deleted_at,
    p.deleted_by,
    u.nama AS satuan_nama,
    COALESCE(bom.total_bahan, 0::bigint) AS total_bahan_baku,
    COALESCE(bom.estimated_cogs, 0::numeric) AS estimated_cogs,
    COALESCE(bom.estimated_cogs, 0::numeric) AS hpp_estimasi,
    p.harga_modal,
    p.markup_persen,
    p.company_id,
    p.branch_id,
    p.warehouse_id,
    wh.name AS warehouse_name,
    wh.code AS warehouse_code,
    p.production_output_type,
    p.station
   FROM item.products p
     LEFT JOIN item.units u ON p.satuan_id = u.id
     LEFT JOIN configuration.warehouses wh ON wh.id = p.warehouse_id
     LEFT JOIN (
       SELECT bi.product_id,
              count(*) AS total_bahan,
              sum(
                bi.qty_required
                * (1::numeric + COALESCE(bi.waste_factor, 0::numeric))
                * (
                    CASE
                      WHEN bi.satuan_id IS NOT NULL
                           AND vrs.satuan_besar_id IS NOT NULL
                           AND bi.satuan_id = vrs.satuan_besar_id
                        THEN COALESCE(vrs.avg_cost, 0::numeric)
                      WHEN vrs.satuan_kecil_id IS NOT NULL
                           AND COALESCE(vrs.konversi_factor, 0::numeric) > 0::numeric
                        THEN COALESCE(vrs.avg_cost, 0::numeric) / vrs.konversi_factor
                      ELSE COALESCE(vrs.avg_cost, 0::numeric)
                    END
                  )
              ) AS estimated_cogs
         FROM manufacturing.bom_items bi
         LEFT JOIN v_raw_materials_stock vrs ON vrs.id = bi.raw_material_id
        WHERE bi.is_active = true
        GROUP BY bi.product_id
     ) bom ON p.id = bom.product_id
  WHERE p.deleted_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arkiv') THEN
    EXECUTE 'ALTER VIEW public.v_products_cogs OWNER TO arkiv';
    EXECUTE 'GRANT SELECT ON TABLE public.v_products_cogs TO arkiv';
  END IF;
END $$;
GRANT SELECT ON TABLE public.v_products_cogs TO authenticated;
GRANT SELECT ON TABLE public.v_products_cogs TO service_role;
