-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — views / materialized views
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:14.388Z
-- =============================================================================

-- public.v_employee_360_summary
CREATE OR REPLACE VIEW "public"."v_employee_360_summary" AS
 SELECT fs.id,
    fs.cycle_id,
    fs.employee_id,
    e.full_name,
    e.nip,
    d.name AS department_name,
    p.title AS position_title,
    fs.leadership_score,
    fs.communication_score,
    fs.collaboration_score,
    fs.accountability_score,
    fs.problem_solving_score,
    fs.overall_360_score,
    fs.kpi_score,
    fs.final_score,
    fs.final_grade,
    fs.burnout_risk,
    fs.promotion_potential,
    fc.period_label,
    fs.created_at
   FROM feedback_summaries fs
     JOIN employees e ON fs.employee_id = e.id
     LEFT JOIN departments d ON e.department_id = d.id
     LEFT JOIN positions p ON e.job_title_id = p.id
     JOIN feedback_cycles fc ON fs.cycle_id = fc.id;

-- public.v_feedback_cycle_progress
CREATE OR REPLACE VIEW "public"."v_feedback_cycle_progress" AS
 SELECT fc.id,
    fc.name,
    fc.period_label,
    fc.status,
    fc.start_date,
    fc.end_date,
    count(DISTINCT fa.employee_id) AS total_employees,
    count(DISTINCT
        CASE
            WHEN fa.status::text = 'completed'::text THEN fa.employee_id
            ELSE NULL::uuid
        END) AS completed_count,
    count(DISTINCT
        CASE
            WHEN fa.status::text = 'pending'::text THEN fa.employee_id
            ELSE NULL::uuid
        END) AS pending_count,
    round(count(DISTINCT
        CASE
            WHEN fa.status::text = 'completed'::text THEN fa.employee_id
            ELSE NULL::uuid
        END)::numeric / NULLIF(count(DISTINCT fa.employee_id), 0)::numeric * 100::numeric, 2) AS completion_percentage
   FROM feedback_cycles fc
     LEFT JOIN feedback_assignments fa ON fc.id = fa.cycle_id
  GROUP BY fc.id, fc.name, fc.period_label, fc.status, fc.start_date, fc.end_date;

-- public.v_finished_goods_stock
CREATE OR REPLACE VIEW "public"."v_finished_goods_stock" AS
 SELECT fgi.id,
    fgi.product_id,
    fgi.qty_available,
    fgi.unit_cost,
    fgi.last_movement_at,
    fgi.is_active,
    fgi.created_by,
    fgi.updated_by,
    fgi.created_at,
    fgi.updated_at,
    p.kode AS product_kode,
    p.nama AS product_nama,
    p.kategori AS product_kategori,
    p.harga_jual,
    fgi.qty_available * COALESCE(fgi.unit_cost, 0::numeric) AS total_value
   FROM finished_goods_inventory fgi
     JOIN products p ON p.id = fgi.product_id
  WHERE fgi.is_active = true;

-- public.v_inventory
CREATE OR REPLACE VIEW "public"."v_inventory" AS
 SELECT inv.id,
    inv.raw_material_id,
    rm.kode AS material_kode,
    rm.nama AS material_nama,
    rm.kategori AS material_kategori,
    inv.qty_available,
    COALESCE(rm.stok_minimum, inv.qty_minimum, 1000::numeric) AS qty_minimum,
    COALESCE(inv.qty_maximum, 10000::numeric) AS qty_maximum,
    inv.unit_cost,
    inv.qty_available * inv.unit_cost AS total_value,
        CASE
            WHEN inv.qty_available <= 0::numeric THEN 'out_of_stock'::text
            WHEN inv.qty_available <= COALESCE(rm.stok_minimum, inv.qty_minimum, 1000::numeric) THEN 'low_stock'::text
            WHEN inv.qty_available >= COALESCE(inv.qty_maximum, 10000::numeric) THEN 'overstock'::text
            ELSE 'normal'::text
        END AS stock_status,
    inv.last_movement_at,
    u_besar.nama AS satuan,
    inv.is_active
   FROM inventory inv
     JOIN raw_materials rm ON rm.id = inv.raw_material_id
     LEFT JOIN units u_besar ON u_besar.id = rm.satuan_besar_id
  WHERE inv.is_active = true;

-- public.v_production_orders
CREATE OR REPLACE VIEW "public"."v_production_orders" AS
 SELECT po.id,
    po.nomor_produksi,
    po.product_id,
    po.outlet_id,
    po.planned_qty,
    po.actual_qty,
    po.status,
    po.planned_material_cost,
    po.actual_material_cost,
    po.overhead_cost,
    po.labor_cost,
    po.packaging_cost,
    po.waste_cost,
    po.hpp_per_unit,
    po.catatan,
    po.started_at,
    po.completed_at,
    po.cancelled_at,
    po.created_by,
    po.updated_by,
    po.created_at,
    po.updated_at,
    po.output_type,
    p.kode AS product_kode,
    p.nama AS product_nama,
    p.harga_jual,
    wip.id AS wip_raw_material_id,
    wip.kode AS wip_raw_material_kode,
    wip.nama AS wip_raw_material_nama,
    COALESCE(material_summary.total_materials, 0::bigint) AS total_materials,
    COALESCE(batch_summary.total_batches, 0::bigint) AS total_batches
   FROM production_orders po
     JOIN products p ON p.id = po.product_id
     LEFT JOIN raw_materials wip ON wip.source_product_id = po.product_id
     LEFT JOIN ( SELECT production_order_materials.production_order_id,
            count(*) AS total_materials
           FROM production_order_materials
          GROUP BY production_order_materials.production_order_id) material_summary ON material_summary.production_order_id = po.id
     LEFT JOIN ( SELECT production_batches.production_order_id,
            count(*) AS total_batches
           FROM production_batches
          GROUP BY production_batches.production_order_id) batch_summary ON batch_summary.production_order_id = po.id;

-- public.v_products_cogs
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
    p.markup_persen
   FROM products p
     LEFT JOIN units u ON p.satuan_id = u.id
     LEFT JOIN ( SELECT bi.product_id,
            count(*) AS total_bahan,
            sum(bi.qty_required * (1::numeric + COALESCE(bi.waste_factor, 0::numeric)) * COALESCE(i.unit_cost, 0::numeric)) AS estimated_cogs
           FROM bom_items bi
             LEFT JOIN raw_materials rm ON bi.raw_material_id = rm.id
             LEFT JOIN inventory i ON rm.id = i.raw_material_id
          WHERE bi.is_active = true
          GROUP BY bi.product_id) bom ON p.id = bom.product_id
  WHERE p.deleted_at IS NULL;

-- public.v_purchase_order_payments
CREATE OR REPLACE VIEW "public"."v_purchase_order_payments" AS
 SELECT po.id AS purchase_order_id,
    po.nomor_po,
    po.supplier_id,
    s.nama_supplier,
    payable.payable_amount,
    COALESCE(term_stats.term_amount, 0::numeric) AS scheduled_amount,
    COALESCE(term_stats.paid_amount, 0::numeric) AS paid_amount,
    GREATEST(payable.payable_amount - COALESCE(term_stats.paid_amount, 0::numeric), 0::numeric) AS outstanding_amount,
    term_stats.next_due_date,
        CASE
            WHEN payable.payable_amount <= 0::numeric THEN 'paid'::text
            WHEN COALESCE(term_stats.paid_amount, 0::numeric) >= payable.payable_amount THEN 'paid'::text
            WHEN COALESCE(term_stats.paid_amount, 0::numeric) > 0::numeric THEN 'partial'::text
            WHEN term_stats.next_due_date IS NOT NULL AND term_stats.next_due_date < CURRENT_DATE THEN 'overdue'::text
            ELSE 'unpaid'::text
        END AS payment_status,
    COALESCE(term_stats.term_count, 0::bigint) AS term_count,
        CASE
            WHEN payable.payable_amount <= 0::numeric THEN 100::numeric
            ELSE LEAST(100::numeric, round(COALESCE(term_stats.paid_amount, 0::numeric) / payable.payable_amount * 100::numeric, 2))
        END AS payment_progress_pct
   FROM purchase_orders po
     LEFT JOIN suppliers s ON s.id = po.supplier_id
     CROSS JOIN LATERAL ( SELECT COALESCE(NULLIF(po.total, 0::numeric), po.subtotal - COALESCE(po.diskon_nominal, 0::numeric) + COALESCE(po.ppn_nominal, 0::numeric), 0::numeric) AS payable_amount) payable
     LEFT JOIN ( SELECT purchase_order_payment_terms.purchase_order_id,
            count(*) AS term_count,
            sum(purchase_order_payment_terms.amount) AS term_amount,
            sum(purchase_order_payment_terms.paid_amount) AS paid_amount,
            min(purchase_order_payment_terms.due_date) FILTER (WHERE (purchase_order_payment_terms.status = ANY (ARRAY['unpaid'::text, 'partial'::text, 'overdue'::text])) AND purchase_order_payment_terms.is_active = true) AS next_due_date
           FROM purchase_order_payment_terms
          WHERE purchase_order_payment_terms.is_active = true
          GROUP BY purchase_order_payment_terms.purchase_order_id) term_stats ON term_stats.purchase_order_id = po.id
  WHERE po.is_active = true;

-- public.v_purchase_orders
CREATE OR REPLACE VIEW "public"."v_purchase_orders" AS
 SELECT po.id,
    po.nomor_po,
    po.tanggal_po,
    po.tanggal_dibutuhkan,
    po.supplier_id,
    po.status,
    po.subtotal,
    po.diskon_persen,
    po.diskon_nominal,
    po.ppn_persen,
    po.ppn_nominal,
    po.total,
    po.catatan,
    po.terms,
    po.alamat_pengiriman,
    po.approved_by,
    po.approved_at,
    po.is_active,
    po.created_by,
    po.updated_by,
    po.created_at,
    po.updated_at,
    po.tanggal_kirim_estimasi,
    po.deleted_at,
    po.sent_by,
    po.sent_at,
    po.sent_via,
    po.cancelled_at,
    po.cancelled_by,
    po.cancellation_reason,
    po.pr_id,
    po.source_type,
    po.production_order_id,
    po.source_reference,
    production.nomor_produksi AS production_order_number,
    s.nama_supplier,
    s.kode AS supplier_kode,
    s.pic_name AS supplier_pic,
    s.email AS supplier_email,
    COALESCE(item_stats.total_items, 0::bigint) AS total_items,
    COALESCE(item_stats.total_items, 0::bigint) AS item_count,
    COALESCE(item_stats.total_qty, 0::numeric) AS total_qty,
    COALESCE(item_stats.total_qty, 0::numeric) AS total_qty_ordered,
    COALESCE(item_stats.received_qty, 0::numeric) AS total_qty_received,
    COALESCE(item_stats.total_value, 0::numeric) AS total_value,
    COALESCE(NULLIF(po.subtotal, 0::numeric), item_stats.total_value, 0::numeric) AS calculated_subtotal,
    COALESCE(NULLIF(po.ppn_nominal, 0::numeric), round((COALESCE(NULLIF(po.subtotal, 0::numeric), item_stats.total_value, 0::numeric) - COALESCE(po.diskon_nominal, 0::numeric)) * COALESCE(po.ppn_persen, 0::numeric) / 100::numeric, 2), 0::numeric) AS calculated_ppn_nominal,
    payable.payable_amount AS grand_total,
    COALESCE(item_stats.received_items, 0::bigint) AS received_items,
    receive.receiving_progress_pct AS progress_pct,
    receive.receiving_progress_pct AS receive_percentage,
    receive.receiving_progress_pct AS received_percentage,
    COALESCE(payment.term_count, 0::bigint) AS payment_term_count,
    payable.payable_amount,
    COALESCE(payment.paid_amount, 0::numeric) AS paid_amount,
    GREATEST(payable.payable_amount - COALESCE(payment.paid_amount, 0::numeric), 0::numeric) AS outstanding_amount,
    payment.next_due_date,
        CASE
            WHEN payable.payable_amount <= 0::numeric THEN 100::numeric
            ELSE LEAST(100::numeric, round(COALESCE(payment.paid_amount, 0::numeric) / payable.payable_amount * 100::numeric, 2))
        END AS payment_progress_pct,
        CASE
            WHEN receive.receiving_progress_pct >= 100::numeric THEN 'received'::text
            WHEN receive.receiving_progress_pct > 0::numeric THEN 'partial'::text
            ELSE 'not_received'::text
        END AS receiving_status,
        CASE
            WHEN payable.payable_amount <= 0::numeric THEN 'paid'::text
            WHEN COALESCE(payment.paid_amount, 0::numeric) >= payable.payable_amount THEN 'paid'::text
            WHEN COALESCE(payment.paid_amount, 0::numeric) > 0::numeric THEN 'partial'::text
            WHEN payment.next_due_date IS NOT NULL AND payment.next_due_date < CURRENT_DATE THEN 'overdue'::text
            ELSE 'unpaid'::text
        END AS payment_status,
        CASE
            WHEN po.status::text = 'cancelled'::text THEN 'cancelled'::text
            WHEN po.status::text = 'draft'::text THEN 'draft'::text
            WHEN receive.receiving_progress_pct >= 100::numeric AND (payable.payable_amount <= 0::numeric OR COALESCE(payment.paid_amount, 0::numeric) >= payable.payable_amount) THEN 'completed'::text
            WHEN receive.receiving_progress_pct >= 100::numeric THEN 'waiting_payment'::text
            WHEN payable.payable_amount > 0::numeric AND COALESCE(payment.paid_amount, 0::numeric) >= payable.payable_amount THEN 'waiting_receipt'::text
            ELSE 'in_progress'::text
        END AS lifecycle_status,
    round((receive.receiving_progress_pct +
        CASE
            WHEN payable.payable_amount <= 0::numeric THEN 100::numeric
            ELSE LEAST(100::numeric, round(COALESCE(payment.paid_amount, 0::numeric) / payable.payable_amount * 100::numeric, 2))
        END) / 2::numeric, 2) AS overall_progress_pct
   FROM purchase_orders po
     LEFT JOIN production_orders production ON production.id = po.production_order_id
     LEFT JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN ( SELECT purchase_order_items.purchase_order_id,
            count(*) AS total_items,
            COALESCE(sum(purchase_order_items.qty_ordered), 0::numeric) AS total_qty,
            COALESCE(sum(purchase_order_items.subtotal), 0::numeric) AS total_value,
            COALESCE(sum(
                CASE
                    WHEN purchase_order_items.qty_received >= purchase_order_items.qty_ordered THEN 1
                    ELSE 0
                END), 0::bigint) AS received_items,
            COALESCE(sum(purchase_order_items.qty_received), 0::numeric) AS received_qty
           FROM purchase_order_items
          WHERE purchase_order_items.is_active = true
          GROUP BY purchase_order_items.purchase_order_id) item_stats ON item_stats.purchase_order_id = po.id
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN COALESCE(item_stats.total_qty, 0::numeric) = 0::numeric THEN 0::numeric
                    ELSE round(COALESCE(item_stats.received_qty, 0::numeric) / item_stats.total_qty * 100::numeric, 2)
                END AS receiving_progress_pct) receive
     CROSS JOIN LATERAL ( SELECT COALESCE(NULLIF(po.total, 0::numeric), COALESCE(NULLIF(po.subtotal, 0::numeric), item_stats.total_value, 0::numeric) - COALESCE(po.diskon_nominal, 0::numeric) + COALESCE(NULLIF(po.ppn_nominal, 0::numeric), round((COALESCE(NULLIF(po.subtotal, 0::numeric), item_stats.total_value, 0::numeric) - COALESCE(po.diskon_nominal, 0::numeric)) * COALESCE(po.ppn_persen, 0::numeric) / 100::numeric, 2), 0::numeric), 0::numeric) AS payable_amount) payable
     LEFT JOIN ( SELECT purchase_order_payment_terms.purchase_order_id,
            count(*) AS term_count,
            sum(purchase_order_payment_terms.amount) AS scheduled_amount,
            sum(purchase_order_payment_terms.paid_amount) AS paid_amount,
            min(purchase_order_payment_terms.due_date) FILTER (WHERE (purchase_order_payment_terms.status = ANY (ARRAY['unpaid'::text, 'partial'::text, 'overdue'::text])) AND purchase_order_payment_terms.is_active = true) AS next_due_date
           FROM purchase_order_payment_terms
          WHERE purchase_order_payment_terms.is_active = true
          GROUP BY purchase_order_payment_terms.purchase_order_id) payment ON payment.purchase_order_id = po.id
  WHERE po.is_active = true;

-- public.v_raw_materials_stock
CREATE OR REPLACE VIEW "public"."v_raw_materials_stock" AS
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
    COALESCE(i.unit_cost, 0::numeric) AS avg_cost,
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
    COALESCE(i.unit_cost, 0::numeric) AS unit_cost,
    COALESCE(i.qty_available, 0::numeric) * COALESCE(i.unit_cost, 0::numeric) AS total_value
   FROM raw_materials rm
     LEFT JOIN units u1 ON rm.satuan_besar_id = u1.id
     LEFT JOIN units u2 ON rm.satuan_kecil_id = u2.id
     LEFT JOIN inventory i ON rm.id = i.raw_material_id AND i.is_active = true
  WHERE rm.deleted_at IS NULL;

-- public.v_returnable_items
CREATE OR REPLACE VIEW "public"."v_returnable_items" AS
 SELECT gi.id AS grn_item_id,
    gi.grn_id,
    gi.raw_material_id,
    rm.kode AS raw_material_kode,
    rm.nama AS raw_material_nama,
    gi.qty_diterima,
    gi.qty_returned,
    gi.qty_diterima - gi.qty_returned AS qty_available_to_return,
    COALESCE(poi.harga_satuan, 0::numeric) AS unit_price,
    gi.batch_number,
    gi.expiry_date,
    gi.qc_status,
    g.supplier_id,
    s.nama_supplier,
    u.nama AS satuan
   FROM grn_items gi
     JOIN grn g ON g.id = gi.grn_id
     JOIN raw_materials rm ON rm.id = gi.raw_material_id
     JOIN suppliers s ON s.id = g.supplier_id
     LEFT JOIN purchase_order_items poi ON poi.id = gi.purchase_order_item_id
     LEFT JOIN units u ON u.id = gi.satuan_id
  WHERE (g.status::text = ANY (ARRAY['received'::character varying, 'partially_received'::character varying]::text[])) AND gi.qty_diterima > COALESCE(gi.qty_returned, 0::numeric) AND (gi.qc_status::text = ANY (ARRAY['rejected'::character varying, 'partially_rejected'::character varying]::text[]));

-- public.v_supplier_price_history
CREATE OR REPLACE VIEW "public"."v_supplier_price_history" AS
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
   FROM supplier_price_lists spl
     LEFT JOIN suppliers s ON spl.supplier_id = s.id
     LEFT JOIN raw_materials bb ON spl.bahan_baku_id = bb.id
     LEFT JOIN units u ON spl.satuan_id = u.id
  WHERE spl.is_active = true
  ORDER BY spl.supplier_id, spl.bahan_baku_id, spl.berlaku_dari DESC;

-- public.v_supplier_price_lists
CREATE OR REPLACE VIEW "public"."v_supplier_price_lists" AS
 SELECT spl.id,
    spl.supplier_id,
    spl.bahan_baku_id,
    spl.harga,
    spl.satuan_id,
    spl.minimum_qty,
    spl.lead_time_days,
    spl.is_preferred,
    spl.is_active,
    spl.berlaku_dari,
    spl.berlaku_sampai,
    spl.catatan,
    spl.created_at,
    spl.updated_at,
    spl.created_by,
    spl.updated_by,
    s.kode AS supplier_kode,
    s.nama_supplier,
    s.payment_terms AS supplier_payment_terms,
    s.currency AS supplier_currency,
    rb.kode AS bahan_baku_kode,
    rb.nama AS bahan_baku_nama,
    rb.kategori AS bahan_baku_kategori,
    u.kode AS satuan_kode,
    u.nama AS satuan_nama
   FROM supplier_price_lists spl
     LEFT JOIN suppliers s ON spl.supplier_id = s.id
     LEFT JOIN raw_materials rb ON spl.bahan_baku_id = rb.id
     LEFT JOIN units u ON spl.satuan_id = u.id
  WHERE spl.deleted_at IS NULL AND spl.is_active = true;

-- public.v_supplier_price_stats
CREATE OR REPLACE VIEW "public"."v_supplier_price_stats" AS
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
   FROM supplier_price_lists spl
     LEFT JOIN suppliers s ON spl.supplier_id = s.id
     LEFT JOIN raw_materials bb ON spl.bahan_baku_id = bb.id
     LEFT JOIN LATERAL ( SELECT supplier_price_lists.harga
           FROM supplier_price_lists
          WHERE supplier_price_lists.supplier_id = spl.supplier_id AND supplier_price_lists.bahan_baku_id = spl.bahan_baku_id AND supplier_price_lists.is_active = true
          ORDER BY supplier_price_lists.berlaku_dari DESC
         LIMIT 1) current_price ON true
     LEFT JOIN LATERAL ( SELECT supplier_price_lists.harga
           FROM supplier_price_lists
          WHERE supplier_price_lists.supplier_id = spl.supplier_id AND supplier_price_lists.bahan_baku_id = spl.bahan_baku_id
          ORDER BY supplier_price_lists.berlaku_dari
         LIMIT 1) first_price ON true
  WHERE spl.is_active = true
  GROUP BY spl.supplier_id, s.nama_supplier, spl.bahan_baku_id, bb.nama, current_price.harga, first_price.harga
  ORDER BY spl.supplier_id, spl.bahan_baku_id;

