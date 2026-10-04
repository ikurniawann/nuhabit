-- -----------------------------------------------------------------------------
-- v_raw_materials_stock_by_warehouse — hanya bahan yang benar-benar ada di stall
--
-- Versi sebelumnya (20260821190000) memasangkan SETIAP bahan baku dengan SETIAP
-- stall lewat CROSS JOIN, supaya jumlah "Total Bahan" tidak berubah saat ganti
-- stall. Efeknya daftar master tampak identik di semua stall — stall yang tidak
-- menyimpan bahan apa pun tetap menampilkan seluruh 266 bahan dengan stok 0.
--
-- Yang dibutuhkan operasional adalah kebalikannya: daftar per stall harus berisi
-- bahan yang memang ada di stall itu saja. `item.raw_materials` tidak punya
-- kolom warehouse (berbeda dari `item.products`), jadi satu-satunya penanda
-- "bahan ini ada di stall itu" adalah keberadaan baris `inventory.inventory`.
--
-- Karena itu CROSS JOIN diganti INNER JOIN ke agregat inventory: bahan tanpa
-- baris inventory di suatu stall tidak muncul untuk stall tersebut. Bahan yang
-- pernah distok lalu habis TETAP muncul (qty 0, status HABIS) karena baris
-- inventory-nya masih ada — yang hilang hanya bahan yang memang tidak pernah
-- ditempatkan di stall itu.
--
-- Kolom dan urutannya sengaja identik dengan versi sebelumnya agar
-- CREATE OR REPLACE diterima Postgres dan caller tidak perlu berubah.
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
   i.warehouse_id
  FROM raw_materials rm
    -- INNER JOIN: stall hanya "punya" bahan ini bila ada baris inventory-nya.
    JOIN ( SELECT inv.raw_material_id,
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
      ON rm.id = i.raw_material_id
    LEFT JOIN units u1 ON rm.satuan_besar_id = u1.id
    LEFT JOIN units u2 ON rm.satuan_kecil_id = u2.id
 WHERE rm.deleted_at IS NULL;
