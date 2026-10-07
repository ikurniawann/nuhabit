-- =============================================================================
-- Product Purchase Orders — module_type, vendor_id, product line items
-- =============================================================================

ALTER TABLE purchasing.purchase_orders
    ADD COLUMN IF NOT EXISTS module_type text DEFAULT 'raw_material' NOT NULL,
    ADD COLUMN IF NOT EXISTS vendor_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_module_type_check'
    ) THEN
        ALTER TABLE purchasing.purchase_orders
            ADD CONSTRAINT purchase_orders_module_type_check
            CHECK (module_type = ANY (ARRAY['raw_material'::text, 'product'::text]));
    END IF;
END $$;

ALTER TABLE purchasing.purchase_orders
    ALTER COLUMN supplier_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_vendor_id_fkey'
    ) THEN
        ALTER TABLE purchasing.purchase_orders
            ADD CONSTRAINT purchase_orders_vendor_id_fkey
            FOREIGN KEY (vendor_id) REFERENCES purchasing.vendors(id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_module_type
    ON purchasing.purchase_orders (module_type);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_id
    ON purchasing.purchase_orders (vendor_id);

UPDATE purchasing.purchase_orders
SET module_type = 'raw_material'
WHERE module_type IS NULL OR module_type = '';

ALTER TABLE purchasing.purchase_order_items
    ADD COLUMN IF NOT EXISTS product_id uuid;

ALTER TABLE purchasing.purchase_order_items
    ALTER COLUMN raw_material_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_product_id_fkey'
    ) THEN
        ALTER TABLE purchasing.purchase_order_items
            ADD CONSTRAINT purchase_order_items_product_id_fkey
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_item_target_check'
    ) THEN
        ALTER TABLE purchasing.purchase_order_items
            ADD CONSTRAINT purchase_order_items_item_target_check
            CHECK (
                (raw_material_id IS NOT NULL AND product_id IS NULL)
                OR (product_id IS NOT NULL AND raw_material_id IS NULL)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product_id
    ON purchasing.purchase_order_items (product_id);

-- Extend v_purchase_orders with vendor + module metadata
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
    po.branch_id,
    po.module_type,
    po.vendor_id,
    v.name AS vendor_name,
    v.code AS vendor_code
   FROM purchase_orders po
     LEFT JOIN production_orders production ON production.id = po.production_order_id
     LEFT JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN vendors v ON v.id = po.vendor_id
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
