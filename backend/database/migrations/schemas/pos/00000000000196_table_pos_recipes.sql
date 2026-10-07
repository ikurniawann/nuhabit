-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_recipes
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:48.013Z
-- =============================================================================

-- Table: pos.pos_recipes
CREATE TABLE "pos"."pos_recipes" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "product_id" uuid,
    "raw_material_id" uuid NOT NULL,
    "quantity_per_unit" numeric(12,4) NOT NULL,
    "unit_of_measure" character varying(20) NOT NULL,
    "waste_percentage" numeric(5,2) DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_recipes"
    ADD CONSTRAINT "pos_recipes_product_id_raw_material_id_key" UNIQUE (product_id, raw_material_id);

ALTER TABLE ONLY "pos"."pos_recipes"
    ADD CONSTRAINT "pos_recipes_pkey" PRIMARY KEY (id);

COMMENT ON TABLE "pos"."pos_recipes" IS 'Bill of Materials: mapping products to raw_materials (purchasing module) for inventory deduction';
