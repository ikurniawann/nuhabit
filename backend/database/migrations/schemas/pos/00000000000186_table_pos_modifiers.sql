-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_modifiers
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:42.054Z
-- =============================================================================

-- Table: pos.pos_modifiers
CREATE TABLE "pos"."pos_modifiers" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "group_id" uuid,
    "name" character varying(100) NOT NULL,
    "price_adjustment" numeric(12,2) DEFAULT 0,
    "display_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_modifiers"
    ADD CONSTRAINT "pos_modifiers_pkey" PRIMARY KEY (id);
