-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.purchase_returns
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:02.097Z
-- =============================================================================

-- Table: purchasing.purchase_returns
CREATE TABLE "purchasing"."purchase_returns" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "return_number" character varying(50) NOT NULL,
    "grn_id" uuid,
    "supplier_id" uuid,
    "return_date" date DEFAULT CURRENT_DATE NOT NULL,
    "reason_type" character varying(50) NOT NULL,
    "reason_notes" text,
    "status" character varying(50) DEFAULT 'draft'::character varying,
    "approved_by" uuid,
    "approved_at" timestamp without time zone,
    "rejection_reason" text,
    "total_amount" numeric(12,2) DEFAULT 0,
    "shipping_date" date,
    "tracking_number" character varying(100),
    "notes" text,
    "created_by" uuid,
    "created_at" timestamp without time zone DEFAULT now(),
    "updated_at" timestamp without time zone DEFAULT now()
);

ALTER TABLE ONLY "purchasing"."purchase_returns"
    ADD CONSTRAINT "purchase_returns_return_number_key" UNIQUE (return_number);

ALTER TABLE ONLY "purchasing"."purchase_returns"
    ADD CONSTRAINT "purchase_returns_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "purchasing"."purchase_returns"
    ADD CONSTRAINT "purchase_returns_reason_type_check" CHECK (reason_type::text = ANY (ARRAY['damaged'::character varying, 'wrong_item'::character varying, 'expired'::character varying, 'overstock'::character varying, 'specification_mismatch'::character varying, 'other'::character varying]::text[]));

ALTER TABLE ONLY "purchasing"."purchase_returns"
    ADD CONSTRAINT "purchase_returns_status_check" CHECK (status::text = ANY (ARRAY['draft'::character varying, 'pending_approval'::character varying, 'approved'::character varying, 'rejected'::character varying, 'completed'::character varying, 'cancelled'::character varying]::text[]));

CREATE INDEX idx_purchase_returns_created_by ON purchasing.purchase_returns USING btree (created_by);

CREATE INDEX idx_purchase_returns_grn ON purchasing.purchase_returns USING btree (grn_id);

CREATE INDEX idx_purchase_returns_return_date ON purchasing.purchase_returns USING btree (return_date);

CREATE INDEX idx_purchase_returns_status ON purchasing.purchase_returns USING btree (status);

CREATE INDEX idx_purchase_returns_supplier ON purchasing.purchase_returns USING btree (supplier_id);

COMMENT ON TABLE "purchasing"."purchase_returns" IS 'Purchase return transactions for returning goods to suppliers';
COMMENT ON COLUMN "purchasing"."purchase_returns"."reason_type" IS 'Reason for return: damaged, wrong_item, expired, overstock, specification_mismatch, other';
COMMENT ON COLUMN "purchasing"."purchase_returns"."status" IS 'Workflow status: draft, pending_approval, approved, rejected, completed, cancelled';
