-- =============================================================================
-- Purchase Requests — distinguish raw material vs product module
-- =============================================================================

ALTER TABLE purchasing.purchase_requests
    ADD COLUMN IF NOT EXISTS module_type text DEFAULT 'raw_material' NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requests_module_type_check'
    ) THEN
        ALTER TABLE purchasing.purchase_requests
            ADD CONSTRAINT purchase_requests_module_type_check
            CHECK (module_type = ANY (ARRAY['raw_material'::text, 'product'::text]));
    END IF;
END $$;

UPDATE purchasing.purchase_requests
SET module_type = 'raw_material'
WHERE module_type IS NULL OR module_type = '';

CREATE INDEX IF NOT EXISTS idx_purchase_requests_module_type
    ON purchasing.purchase_requests (module_type);

COMMENT ON COLUMN purchasing.purchase_requests.module_type IS 'Purchasing module source: raw_material or product';
