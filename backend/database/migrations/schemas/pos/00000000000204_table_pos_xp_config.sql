-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_xp_config
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:52.851Z
-- =============================================================================

-- Table: pos.pos_xp_config
CREATE TABLE "pos"."pos_xp_config" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "product_id" uuid,
    "xp_multiplier" numeric(5,2) DEFAULT 1.0,
    "bonus_xp" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_xp_config"
    ADD CONSTRAINT "pos_xp_config_product_id_key" UNIQUE (product_id);

ALTER TABLE ONLY "pos"."pos_xp_config"
    ADD CONSTRAINT "pos_xp_config_pkey" PRIMARY KEY (id);
