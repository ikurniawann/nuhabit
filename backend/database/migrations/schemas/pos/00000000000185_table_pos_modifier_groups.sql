-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_modifier_groups
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:41.438Z
-- =============================================================================

-- Table: pos.pos_modifier_groups
CREATE TABLE "pos"."pos_modifier_groups" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "name" character varying(100) NOT NULL,
    "min_selection" integer DEFAULT 0,
    "max_selection" integer DEFAULT 1,
    "display_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_modifier_groups"
    ADD CONSTRAINT "pos_modifier_groups_pkey" PRIMARY KEY (id);
