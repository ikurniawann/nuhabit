-- =============================================================================
-- table: purchasing.vendor_credits [domain: purchasing]
-- Vendor credit notes for receive/QC rejects (no stock movement).
-- Maintained manually until next `npm run db:pull`.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "purchasing"."vendor_credits" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "credit_number" character varying(50) NOT NULL,
    "grn_id" uuid NOT NULL,
    "purchase_order_id" uuid,
    "supplier_id" uuid,
    "source_type" character varying(30) NOT NULL,
    "credit_date" date DEFAULT CURRENT_DATE NOT NULL,
    "status" character varying(50) DEFAULT 'draft'::character varying NOT NULL,
    "total_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "reason_notes" text,
    "notes" text,
    "approved_by" uuid,
    "approved_at" timestamp without time zone,
    "rejection_reason" text,
    "created_by" uuid,
    "created_at" timestamp without time zone DEFAULT now(),
    "updated_at" timestamp without time zone DEFAULT now()
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_credits_pkey'
    ) THEN
        ALTER TABLE ONLY "purchasing"."vendor_credits"
            ADD CONSTRAINT "vendor_credits_pkey" PRIMARY KEY (id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_credits_credit_number_key'
    ) THEN
        ALTER TABLE ONLY "purchasing"."vendor_credits"
            ADD CONSTRAINT "vendor_credits_credit_number_key" UNIQUE (credit_number);
    END IF;
END $$;

ALTER TABLE ONLY "purchasing"."vendor_credits"
    DROP CONSTRAINT IF EXISTS vendor_credits_source_type_check;

ALTER TABLE ONLY "purchasing"."vendor_credits"
    ADD CONSTRAINT "vendor_credits_source_type_check" CHECK (
        source_type::text = ANY (
            ARRAY['receive_reject'::character varying, 'qc_reject'::character varying]::text[]
        )
    );

ALTER TABLE ONLY "purchasing"."vendor_credits"
    DROP CONSTRAINT IF EXISTS vendor_credits_status_check;

ALTER TABLE ONLY "purchasing"."vendor_credits"
    ADD CONSTRAINT "vendor_credits_status_check" CHECK (
        status::text = ANY (
            ARRAY[
                'draft'::character varying,
                'pending_approval'::character varying,
                'approved'::character varying,
                'rejected'::character varying,
                'cancelled'::character varying
            ]::text[]
        )
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_credits_grn_source_draft
    ON purchasing.vendor_credits (grn_id, source_type)
    WHERE status = 'draft'::character varying;

CREATE INDEX IF NOT EXISTS idx_vendor_credits_grn ON purchasing.vendor_credits USING btree (grn_id);
CREATE INDEX IF NOT EXISTS idx_vendor_credits_po ON purchasing.vendor_credits USING btree (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_vendor_credits_status ON purchasing.vendor_credits USING btree (status);
CREATE INDEX IF NOT EXISTS idx_vendor_credits_supplier ON purchasing.vendor_credits USING btree (supplier_id);

COMMENT ON TABLE "purchasing"."vendor_credits" IS 'Vendor credit notes for receive/QC rejects (no stock movement)';
COMMENT ON COLUMN "purchasing"."vendor_credits"."source_type" IS 'receive_reject = qty_ditolak at GRN; qc_reject = qty_rejected at QC';
