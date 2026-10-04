-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_product_variants
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:46.807Z
-- =============================================================================

-- Table: pos.pos_product_variants
CREATE TABLE "pos"."pos_product_variants" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "product_id" uuid,
    "name" character varying(100) NOT NULL,
    "group_name" character varying(50) NOT NULL,
    "price_adjustment" numeric(12,2) DEFAULT 0,
    "display_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_product_variants"
    ADD CONSTRAINT "pos_product_variants_pkey" PRIMARY KEY (id);
