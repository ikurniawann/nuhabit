-- =============================================================================
-- Product purchase returns — vendor_id on purchase_returns, product_id on items
-- =============================================================================

ALTER TABLE purchasing.purchase_returns
    ADD COLUMN IF NOT EXISTS vendor_id uuid;

ALTER TABLE purchasing.purchase_returns
    ALTER COLUMN supplier_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'purchase_returns_vendor_id_fkey'
    ) THEN
        ALTER TABLE purchasing.purchase_returns
            ADD CONSTRAINT purchase_returns_vendor_id_fkey
            FOREIGN KEY (vendor_id) REFERENCES purchasing.vendors(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'purchase_returns_party_check'
    ) THEN
        ALTER TABLE purchasing.purchase_returns
            ADD CONSTRAINT purchase_returns_party_check
            CHECK (
                (supplier_id IS NOT NULL AND vendor_id IS NULL)
                OR (vendor_id IS NOT NULL AND supplier_id IS NULL)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_returns_vendor_id
    ON purchasing.purchase_returns (vendor_id);

ALTER TABLE purchasing.purchase_return_items
    ADD COLUMN IF NOT EXISTS product_id uuid;

ALTER TABLE purchasing.purchase_return_items
    ALTER COLUMN raw_material_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'purchase_return_items_product_id_fkey'
    ) THEN
        ALTER TABLE purchasing.purchase_return_items
            ADD CONSTRAINT purchase_return_items_product_id_fkey
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'purchase_return_items_item_target_check'
    ) THEN
        ALTER TABLE purchasing.purchase_return_items
            ADD CONSTRAINT purchase_return_items_item_target_check
            CHECK (
                (raw_material_id IS NOT NULL AND product_id IS NULL)
                OR (product_id IS NOT NULL AND raw_material_id IS NULL)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_return_items_product_id
    ON purchasing.purchase_return_items (product_id);
