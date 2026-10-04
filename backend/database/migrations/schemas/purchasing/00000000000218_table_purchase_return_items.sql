-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.purchase_return_items
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:01.424Z
-- =============================================================================

-- Table: purchasing.purchase_return_items
CREATE TABLE "purchasing"."purchase_return_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "return_id" uuid,
    "grn_item_id" uuid,
    "raw_material_id" uuid,
    "qty_returned" numeric(10,3) NOT NULL,
    "unit_cost" numeric(12,2) NOT NULL,
    "subtotal" numeric(12,2) NOT NULL,
    "batch_number" character varying(100),
    "expiry_date" date,
    "condition_notes" text,
    "qc_status" character varying(50) DEFAULT 'rejected'::character varying,
    "created_at" timestamp without time zone DEFAULT now()
);

ALTER TABLE ONLY "purchasing"."purchase_return_items"
    ADD CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "purchasing"."purchase_return_items"
    ADD CONSTRAINT "purchase_return_items_qc_status_check" CHECK (qc_status::text = ANY (ARRAY['rejected'::character varying, 'partially_rejected'::character varying]::text[]));

ALTER TABLE ONLY "purchasing"."purchase_return_items"
    ADD CONSTRAINT "purchase_return_items_qty_returned_check" CHECK (qty_returned > 0::numeric);

ALTER TABLE ONLY "purchasing"."purchase_return_items"
    ADD CONSTRAINT "purchase_return_items_subtotal_check" CHECK (subtotal >= 0::numeric);

ALTER TABLE ONLY "purchasing"."purchase_return_items"
    ADD CONSTRAINT "purchase_return_items_unit_cost_check" CHECK (unit_cost >= 0::numeric);

CREATE INDEX idx_purchase_return_items_grn_item ON purchasing.purchase_return_items USING btree (grn_item_id);

CREATE INDEX idx_purchase_return_items_raw_material ON purchasing.purchase_return_items USING btree (raw_material_id);

CREATE INDEX idx_purchase_return_items_return_id ON purchasing.purchase_return_items USING btree (return_id);

COMMENT ON TABLE "purchasing"."purchase_return_items" IS 'Individual items in a purchase return';
COMMENT ON COLUMN "purchasing"."purchase_return_items"."qc_status" IS 'QC decision: rejected, partially_rejected';
