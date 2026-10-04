-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_categories
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:37.481Z
-- =============================================================================

-- Table: pos.pos_categories
CREATE TABLE "pos"."pos_categories" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "name" character varying(100) NOT NULL,
    "parent_id" uuid,
    "display_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_categories"
    ADD CONSTRAINT "pos_categories_pkey" PRIMARY KEY (id);
