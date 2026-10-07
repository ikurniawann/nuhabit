-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: manufacturing.production_batches
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:55.271Z
-- =============================================================================

-- Table: manufacturing.production_batches
CREATE TABLE "manufacturing"."production_batches" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "production_order_id" uuid NOT NULL,
    "product_id" uuid NOT NULL,
    "batch_number" character varying(60) NOT NULL,
    "qty_produced" numeric(15,3) DEFAULT 0 NOT NULL,
    "hpp_per_unit" numeric(15,2) DEFAULT 0 NOT NULL,
    "total_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "expiry_date" date,
    "status" character varying(20) DEFAULT 'AVAILABLE'::character varying NOT NULL,
    "created_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "output_type" character varying(20) DEFAULT 'FINISHED_GOOD'::character varying NOT NULL,
    "wip_raw_material_id" uuid
);

ALTER TABLE ONLY "manufacturing"."production_batches"
    ADD CONSTRAINT "production_batches_batch_number_key" UNIQUE (batch_number);

ALTER TABLE ONLY "manufacturing"."production_batches"
    ADD CONSTRAINT "production_batches_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "manufacturing"."production_batches"
    ADD CONSTRAINT "production_batches_output_type_check" CHECK (output_type::text = ANY (ARRAY['FINISHED_GOOD'::character varying, 'WIP'::character varying]::text[]));

ALTER TABLE ONLY "manufacturing"."production_batches"
    ADD CONSTRAINT "production_batches_status_check" CHECK (status::text = ANY (ARRAY['AVAILABLE'::character varying, 'RESERVED'::character varying, 'CONSUMED'::character varying, 'VOID'::character varying]::text[]));

CREATE INDEX idx_production_batches_order ON manufacturing.production_batches USING btree (production_order_id);

CREATE INDEX idx_production_batches_wip_material ON manufacturing.production_batches USING btree (wip_raw_material_id);
