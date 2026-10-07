-- =============================================================================
-- Vendor Price Lists — product purchasing prices per vendor
-- Mirrors purchasing.supplier_price_lists for the product purchasing module.
-- =============================================================================

CREATE TABLE IF NOT EXISTS purchasing.vendor_price_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    product_id uuid NOT NULL,
    harga numeric(15,2) NOT NULL,
    satuan_id uuid,
    minimum_qty numeric(15,4) DEFAULT 1 NOT NULL,
    lead_time_days integer DEFAULT 0 NOT NULL,
    is_preferred boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    berlaku_dari date DEFAULT CURRENT_DATE NOT NULL,
    berlaku_sampai date,
    catatan text,
    company_id uuid,
    branch_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT vendor_price_lists_pkey PRIMARY KEY (id),
    CONSTRAINT vendor_price_lists_vendor_id_product_id_key
        UNIQUE NULLS NOT DISTINCT (vendor_id, product_id),
    CONSTRAINT vendor_price_lists_harga_check CHECK (harga >= 0::numeric),
    CONSTRAINT vendor_price_lists_lead_time_days_check CHECK (lead_time_days >= 0),
    CONSTRAINT vendor_price_lists_minimum_qty_check CHECK (minimum_qty > 0::numeric)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_price_lists_vendor_id_fkey'
    ) THEN
        ALTER TABLE purchasing.vendor_price_lists
            ADD CONSTRAINT vendor_price_lists_vendor_id_fkey
            FOREIGN KEY (vendor_id) REFERENCES purchasing.vendors(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_price_lists_product_id_fkey'
    ) THEN
        ALTER TABLE purchasing.vendor_price_lists
            ADD CONSTRAINT vendor_price_lists_product_id_fkey
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_price_lists_satuan_id_fkey'
    ) THEN
        ALTER TABLE purchasing.vendor_price_lists
            ADD CONSTRAINT vendor_price_lists_satuan_id_fkey
            FOREIGN KEY (satuan_id) REFERENCES units(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_price_lists_company_id_fkey'
    ) THEN
        ALTER TABLE purchasing.vendor_price_lists
            ADD CONSTRAINT vendor_price_lists_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES configuration.companies(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_price_lists_branch_id_fkey'
    ) THEN
        ALTER TABLE purchasing.vendor_price_lists
            ADD CONSTRAINT vendor_price_lists_branch_id_fkey
            FOREIGN KEY (branch_id) REFERENCES configuration.branches(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_price_lists_created_by_fkey'
    ) THEN
        ALTER TABLE purchasing.vendor_price_lists
            ADD CONSTRAINT vendor_price_lists_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES auth.users(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_price_lists_updated_by_fkey'
    ) THEN
        ALTER TABLE purchasing.vendor_price_lists
            ADD CONSTRAINT vendor_price_lists_updated_by_fkey
            FOREIGN KEY (updated_by) REFERENCES auth.users(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_price_lists_deleted_by_fkey'
    ) THEN
        ALTER TABLE purchasing.vendor_price_lists
            ADD CONSTRAINT vendor_price_lists_deleted_by_fkey
            FOREIGN KEY (deleted_by) REFERENCES auth.users(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vendor_price_list_active
    ON purchasing.vendor_price_lists (is_active)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_vendor_price_list_product
    ON purchasing.vendor_price_lists (product_id);

CREATE INDEX IF NOT EXISTS idx_vendor_price_list_vendor
    ON purchasing.vendor_price_lists (vendor_id);

CREATE INDEX IF NOT EXISTS idx_vendor_price_list_preferred
    ON purchasing.vendor_price_lists (is_preferred)
    WHERE is_preferred = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_vendor_price_list_validity
    ON purchasing.vendor_price_lists (berlaku_dari, berlaku_sampai);

CREATE INDEX IF NOT EXISTS idx_vendor_price_lists_company_id
    ON purchasing.vendor_price_lists (company_id);

CREATE INDEX IF NOT EXISTS idx_vendor_price_lists_branch_id
    ON purchasing.vendor_price_lists (branch_id);

COMMENT ON TABLE purchasing.vendor_price_lists IS 'Product purchasing prices per vendor with validity period';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_vendor_price_lists_updated_at'
    ) THEN
        CREATE TRIGGER update_vendor_price_lists_updated_at
            BEFORE UPDATE ON purchasing.vendor_price_lists
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;
