-- FK pr_items.product_id -> products (product module PR lines)

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pr_items_product_id_fkey'
    ) THEN
        ALTER TABLE purchasing.pr_items
            ADD CONSTRAINT pr_items_product_id_fkey
            FOREIGN KEY (product_id) REFERENCES item.products(id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pr_items_product_id
    ON purchasing.pr_items (product_id);
