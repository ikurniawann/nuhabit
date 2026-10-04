-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.feedback_relationship_types
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:13.974Z
-- =============================================================================

-- Table: performance.feedback_relationship_types
CREATE TABLE "performance"."feedback_relationship_types" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" character varying(50) NOT NULL,
    "description" text,
    "display_order" integer DEFAULT 0
);

ALTER TABLE ONLY "performance"."feedback_relationship_types"
    ADD CONSTRAINT "feedback_relationship_types_pkey" PRIMARY KEY (id);
