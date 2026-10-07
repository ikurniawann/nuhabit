-- =============================================================================
-- table: purchasing.vendor_credit_items [domain: purchasing]
-- Line items for vendor credits (receive/QC reject quantities).
-- Maintained manually until next `npm run db:pull`.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "purchasing"."vendor_credit_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "vendor_credit_id" uuid NOT NULL,
    "grn_item_id" uuid NOT NULL,
    "raw_material_id" uuid NOT NULL,
    "qty" numeric(14,4) DEFAULT 0 NOT NULL,
    "unit_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "line_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "notes" text,
    "created_at" timestamp without time zone DEFAULT now(),
    "updated_at" timestamp without time zone DEFAULT now()
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_credit_items_pkey'
    ) THEN
        ALTER TABLE ONLY "purchasing"."vendor_credit_items"
            ADD CONSTRAINT "vendor_credit_items_pkey" PRIMARY KEY (id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_credit_items_unique_line'
    ) THEN
        ALTER TABLE ONLY "purchasing"."vendor_credit_items"
            ADD CONSTRAINT "vendor_credit_items_unique_line" UNIQUE (vendor_credit_id, grn_item_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vendor_credit_items_credit ON purchasing.vendor_credit_items USING btree (vendor_credit_id);
CREATE INDEX IF NOT EXISTS idx_vendor_credit_items_grn_item ON purchasing.vendor_credit_items USING btree (grn_item_id);

COMMENT ON TABLE "purchasing"."vendor_credit_items" IS 'Line items for vendor credit notes';
