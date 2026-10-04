-- =============================================================================
-- Product deliveries & goods receipt — vendor_id on deliveries/grn, product_id on grn_items
-- =============================================================================

ALTER TABLE purchasing.deliveries
    ADD COLUMN IF NOT EXISTS vendor_id uuid;

ALTER TABLE purchasing.deliveries
    ALTER COLUMN supplier_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'deliveries_vendor_id_fkey'
    ) THEN
        ALTER TABLE purchasing.deliveries
            ADD CONSTRAINT deliveries_vendor_id_fkey
            FOREIGN KEY (vendor_id) REFERENCES purchasing.vendors(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'deliveries_party_check'
    ) THEN
        ALTER TABLE purchasing.deliveries
            ADD CONSTRAINT deliveries_party_check
            CHECK (
                (supplier_id IS NOT NULL AND vendor_id IS NULL)
                OR (vendor_id IS NOT NULL AND supplier_id IS NULL)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deliveries_vendor_id
    ON purchasing.deliveries (vendor_id);

ALTER TABLE purchasing.grn
    ADD COLUMN IF NOT EXISTS vendor_id uuid;

ALTER TABLE purchasing.grn
    ALTER COLUMN supplier_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'grn_vendor_id_fkey'
    ) THEN
        ALTER TABLE purchasing.grn
            ADD CONSTRAINT grn_vendor_id_fkey
            FOREIGN KEY (vendor_id) REFERENCES purchasing.vendors(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'grn_party_check'
    ) THEN
        ALTER TABLE purchasing.grn
            ADD CONSTRAINT grn_party_check
            CHECK (
                (supplier_id IS NOT NULL AND vendor_id IS NULL)
                OR (vendor_id IS NOT NULL AND supplier_id IS NULL)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_grn_vendor_id
    ON purchasing.grn (vendor_id);

ALTER TABLE purchasing.grn_items
    ADD COLUMN IF NOT EXISTS product_id uuid;

ALTER TABLE purchasing.grn_items
    ALTER COLUMN raw_material_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'grn_items_product_id_fkey'
    ) THEN
        ALTER TABLE purchasing.grn_items
            ADD CONSTRAINT grn_items_product_id_fkey
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'grn_items_item_target_check'
    ) THEN
        ALTER TABLE purchasing.grn_items
            ADD CONSTRAINT grn_items_item_target_check
            CHECK (
                (raw_material_id IS NOT NULL AND product_id IS NULL)
                OR (product_id IS NOT NULL AND raw_material_id IS NULL)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_grn_items_product_id
    ON purchasing.grn_items (product_id);
