-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: manufacturing.production_orders
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:56.500Z
-- =============================================================================

-- Table: manufacturing.production_orders
CREATE TABLE "manufacturing"."production_orders" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "nomor_produksi" character varying(40) NOT NULL,
    "product_id" uuid NOT NULL,
    "outlet_id" uuid,
    "planned_qty" numeric(15,3) NOT NULL,
    "actual_qty" numeric(15,3) DEFAULT 0 NOT NULL,
    "status" character varying(20) DEFAULT 'DRAFT'::character varying NOT NULL,
    "planned_material_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "actual_material_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "overhead_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "labor_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "packaging_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "waste_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "hpp_per_unit" numeric(15,2) DEFAULT 0 NOT NULL,
    "catatan" text,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "created_by" uuid,
    "updated_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "output_type" character varying(20) DEFAULT 'FINISHED_GOOD'::character varying NOT NULL
);

ALTER TABLE ONLY "manufacturing"."production_orders"
    ADD CONSTRAINT "production_orders_nomor_produksi_key" UNIQUE (nomor_produksi);

ALTER TABLE ONLY "manufacturing"."production_orders"
    ADD CONSTRAINT "production_orders_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "manufacturing"."production_orders"
    ADD CONSTRAINT "production_orders_actual_qty_check" CHECK (actual_qty >= 0::numeric);

ALTER TABLE ONLY "manufacturing"."production_orders"
    ADD CONSTRAINT "production_orders_output_type_check" CHECK (output_type::text = ANY (ARRAY['FINISHED_GOOD'::character varying, 'WIP'::character varying]::text[]));

ALTER TABLE ONLY "manufacturing"."production_orders"
    ADD CONSTRAINT "production_orders_planned_qty_check" CHECK (planned_qty > 0::numeric);

ALTER TABLE ONLY "manufacturing"."production_orders"
    ADD CONSTRAINT "production_orders_status_check" CHECK (status::text = ANY (ARRAY['DRAFT'::character varying, 'RELEASED'::character varying, 'IN_PROGRESS'::character varying, 'COMPLETED'::character varying, 'CANCELLED'::character varying]::text[]));

CREATE INDEX idx_production_orders_created_at ON manufacturing.production_orders USING btree (created_at DESC);

CREATE INDEX idx_production_orders_product ON manufacturing.production_orders USING btree (product_id);

CREATE INDEX idx_production_orders_status ON manufacturing.production_orders USING btree (status);
