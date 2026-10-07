-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_inventory_settings
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:39.394Z
-- =============================================================================

-- Table: pos.pos_inventory_settings
CREATE TABLE "pos"."pos_inventory_settings" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "product_id" uuid,
    "allow_negative_stock" boolean DEFAULT true,
    "low_stock_threshold" integer DEFAULT 10,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_inventory_settings"
    ADD CONSTRAINT "pos_inventory_settings_product_id_key" UNIQUE (product_id);

ALTER TABLE ONLY "pos"."pos_inventory_settings"
    ADD CONSTRAINT "pos_inventory_settings_pkey" PRIMARY KEY (id);
