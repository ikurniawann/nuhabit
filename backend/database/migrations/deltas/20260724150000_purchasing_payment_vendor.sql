-- =============================================================================
-- EPIC-026 fix — Dukungan vendor pada termin & pembayaran PO (scope product/general)
-- =============================================================================
-- Masalah: purchase_order_payment_terms & vendor_payments hanya punya
-- `supplier_id uuid NOT NULL` (FK -> suppliers). PO scope 'general' & 'product'
-- memakai `vendor_id` (tabel vendors) dan menyimpan supplier_id = NULL, sehingga
-- pembuatan termin / pencatatan pembayaran gagal dengan:
--   null value in column "supplier_id" ... violates not-null constraint (23502)
--
-- Solusi: tambah kolom `vendor_id` + longgarkan supplier_id jadi nullable +
-- party_check XOR — MENIRU pola yang SUDAH dipakai pada deliveries & grn
-- (20260702150000_product_delivery_grn.sql). Idempoten, aman diulang.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- purchase_order_payment_terms
-- ---------------------------------------------------------------------------
ALTER TABLE purchasing.purchase_order_payment_terms
    ADD COLUMN IF NOT EXISTS vendor_id uuid;

ALTER TABLE purchasing.purchase_order_payment_terms
    ALTER COLUMN supplier_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_payment_terms_vendor_id_fkey'
    ) THEN
        ALTER TABLE purchasing.purchase_order_payment_terms
            ADD CONSTRAINT purchase_order_payment_terms_vendor_id_fkey
            FOREIGN KEY (vendor_id) REFERENCES purchasing.vendors(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_payment_terms_party_check'
    ) THEN
        ALTER TABLE purchasing.purchase_order_payment_terms
            ADD CONSTRAINT purchase_order_payment_terms_party_check
            CHECK (
                (supplier_id IS NOT NULL AND vendor_id IS NULL)
                OR (vendor_id IS NOT NULL AND supplier_id IS NULL)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_po_payment_terms_vendor
    ON purchasing.purchase_order_payment_terms (vendor_id);

-- ---------------------------------------------------------------------------
-- vendor_payments
-- ---------------------------------------------------------------------------
ALTER TABLE purchasing.vendor_payments
    ADD COLUMN IF NOT EXISTS vendor_id uuid;

ALTER TABLE purchasing.vendor_payments
    ALTER COLUMN supplier_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_payments_vendor_id_fkey'
    ) THEN
        ALTER TABLE purchasing.vendor_payments
            ADD CONSTRAINT vendor_payments_vendor_id_fkey
            FOREIGN KEY (vendor_id) REFERENCES purchasing.vendors(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_payments_party_check'
    ) THEN
        ALTER TABLE purchasing.vendor_payments
            ADD CONSTRAINT vendor_payments_party_check
            CHECK (
                (supplier_id IS NOT NULL AND vendor_id IS NULL)
                OR (vendor_id IS NOT NULL AND supplier_id IS NULL)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vendor_payments_vendor
    ON purchasing.vendor_payments (vendor_id);
