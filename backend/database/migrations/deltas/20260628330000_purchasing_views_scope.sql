-- =============================================================================
-- Expose company_id/branch_id pada view enriched purchasing/produksi agar API
-- list bisa memfilter berdasarkan scope branch.
--   v_purchase_orders, v_purchase_order_payments  -> dari purchase_orders
--   v_production_orders                            -> dari production_orders
-- Kolom ditambahkan di akhir (kompatibel CREATE OR REPLACE VIEW).
-- =============================================================================

-- v_production_orders -------------------------------------------------------
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
    COALESCE(batch_summary.total_batches, 0::bigint) AS total_batches,
    po.company_id,
    po.branch_id
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

-- v_purchase_order_payments -------------------------------------------------
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
        END AS payment_progress_pct,
    po.company_id,
    po.branch_id
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

-- v_purchase_orders ---------------------------------------------------------
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
        END) / 2::numeric, 2) AS overall_progress_pct,
    po.company_id,
    po.branch_id
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
