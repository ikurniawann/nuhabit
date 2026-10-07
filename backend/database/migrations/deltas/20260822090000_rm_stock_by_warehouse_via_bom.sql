-- -----------------------------------------------------------------------------
-- v_raw_materials_stock_by_warehouse — bahan yang dibutuhkan resep tiap stall
--
-- Riwayat singkat, supaya jelas kenapa view ini sudah tiga kali berganti bentuk:
--   20260821190000  CROSS JOIN semua stall  -> setiap stall menampilkan seluruh
--                   266 bahan; tidak terasa terfilter sama sekali.
--   20260821200000  INNER JOIN inventory    -> benar secara gudang, tapi tabel
--                   inventory kosong sehingga semua stall jadi kosong.
--   (ini)           INNER JOIN resep        -> lihat di bawah.
--
-- `item.raw_materials` tidak punya kolom warehouse (berbeda dari `item.products`
-- yang punya `warehouse_id`), karena satu bahan wajar dipakai banyak stall.
-- Tautan yang benar-benar terisi datanya adalah lewat resep:
--
--     bahan  <-- manufacturing.bom_items -->  produk  --(warehouse_id)-->  stall
--
-- Jadi "bahan baku di stall X" = bahan yang dibutuhkan resep produk milik stall
-- X. Itu mencerminkan halaman Produk yang memang sudah terfilter per stall, dan
-- langsung berisi data tanpa menunggu stok diisi. Stall tanpa produk (mis.
-- WH-01 "Operasional") otomatis kosong.
--
-- Angka stok tetap diambil dari `inventory.inventory` untuk pasangan
-- (bahan, stall) tersebut lewat LEFT JOIN — bahan yang dibutuhkan tapi belum
-- pernah distok tampil sebagai 0 / HABIS, bukan hilang dari daftar.
--
-- Konsekuensi yang disengaja: bahan yang distok di suatu stall tapi tidak
-- dipakai resep apa pun (kemasan, bahan pembersih) tidak muncul di stall itu.
--
-- Kolom dan urutannya identik dengan versi sebelumnya agar CREATE OR REPLACE
-- diterima dan tidak ada caller yang perlu berubah.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW "public"."v_raw_materials_stock_by_warehouse" AS
SELECT rm.id,
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
   rm.created_by,
   rm.updated_by,
   u1.nama AS satuan_besar_nama,
   u2.nama AS satuan_kecil_nama,
   COALESCE(i.qty_available, 0::numeric) AS qty_onhand,
   0 AS qty_reserved,
   COALESCE(i.qty_on_order, 0::numeric) AS qty_on_order,
   COALESCE(NULLIF(i.unit_cost, 0::numeric), rm.harga_beli, 0::numeric) AS avg_cost,
       CASE
           WHEN COALESCE(i.qty_available, 0::numeric) <= 0::numeric THEN 'HABIS'::text
           WHEN COALESCE(i.qty_available, 0::numeric) <= COALESCE(i.qty_minimum, rm.stok_minimum, 0::numeric) THEN 'MENIPIS'::text
           ELSE 'AMAN'::text
       END AS status_stok,
   COALESCE(rm.material_type, 'PURCHASED'::character varying) AS material_type,
   rm.source_product_id,
   rm.deleted_at,
   rm.deleted_by,
   u1.nama AS satuan,
   COALESCE(i.lokasi_rak, '-'::character varying) AS lokasi_rak,
   COALESCE(i.qty_minimum, rm.stok_minimum, 0::numeric) AS min_stock,
   COALESCE(i.qty_maximum, rm.stok_maximum) AS max_stock,
   COALESCE(NULLIF(i.unit_cost, 0::numeric), rm.harga_beli, 0::numeric) AS unit_cost,
   COALESCE(i.qty_available, 0::numeric) * COALESCE(i.unit_cost, 0::numeric) AS total_value,
   rm.company_id,
   rm.branch_id,
   rm.harga_beli,
   rm.coa,
   rm.coa_production,
   rm.coa_rnd,
   rm.coa_asset,
   sw.warehouse_id
  FROM raw_materials rm
    -- Bahan "milik" stall bila dipakai resep produk stall tersebut.
    JOIN ( SELECT DISTINCT p.warehouse_id, b.raw_material_id
             FROM manufacturing.bom_items b
             JOIN item.products p ON p.id = b.product_id
            WHERE b.is_active = true
              AND p.deleted_at IS NULL
              AND p.warehouse_id IS NOT NULL) sw
      ON sw.raw_material_id = rm.id
    LEFT JOIN units u1 ON rm.satuan_besar_id = u1.id
    LEFT JOIN units u2 ON rm.satuan_kecil_id = u2.id
    -- Stok nyata untuk pasangan (bahan, stall); LEFT agar bahan yang belum
    -- pernah distok tetap muncul sebagai 0 / HABIS.
    LEFT JOIN ( SELECT inv.raw_material_id,
           inv.warehouse_id,
           sum(inv.qty_available) AS qty_available,
           sum(inv.qty_on_order) AS qty_on_order,
               CASE
                   WHEN sum(inv.qty_available) > 0::numeric
                       THEN sum(inv.qty_available * COALESCE(inv.unit_cost, 0::numeric)) / sum(inv.qty_available)
                   ELSE avg(inv.unit_cost)
               END AS unit_cost,
           min(inv.qty_minimum) AS qty_minimum,
           max(inv.qty_maximum) AS qty_maximum,
           (array_agg(inv.lokasi_rak ORDER BY inv.qty_available DESC))[1] AS lokasi_rak
          FROM inventory inv
         WHERE inv.is_active = true
           AND inv.warehouse_id IS NOT NULL
         GROUP BY inv.raw_material_id, inv.warehouse_id) i
      ON i.raw_material_id = rm.id AND i.warehouse_id = sw.warehouse_id
 WHERE rm.deleted_at IS NULL;
