-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: manufacturing.production_order_materials
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:55.889Z
-- =============================================================================

-- Table: manufacturing.production_order_materials
CREATE TABLE "manufacturing"."production_order_materials" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "production_order_id" uuid NOT NULL,
    "raw_material_id" uuid NOT NULL,
    "satuan_id" uuid,
    "qty_planned" numeric(15,4) DEFAULT 0 NOT NULL,
    "qty_actual" numeric(15,4) DEFAULT 0 NOT NULL,
    "waste_qty" numeric(15,4) DEFAULT 0 NOT NULL,
    "unit_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "total_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "inventory_movement_id" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "manufacturing"."production_order_materials"
    ADD CONSTRAINT "production_order_materials_pkey" PRIMARY KEY (id);

CREATE INDEX idx_production_materials_order ON manufacturing.production_order_materials USING btree (production_order_id);

CREATE INDEX idx_production_materials_raw_material ON manufacturing.production_order_materials USING btree (raw_material_id);
