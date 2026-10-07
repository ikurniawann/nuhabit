-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.performance_categories
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:34.565Z
-- =============================================================================

-- Table: performance.performance_categories
CREATE TABLE "performance"."performance_categories" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "category_name" character varying(50) NOT NULL,
    "min_score" numeric(6,2) NOT NULL,
    "max_score" numeric(6,2) NOT NULL,
    "description" text
);

ALTER TABLE ONLY "performance"."performance_categories"
    ADD CONSTRAINT "performance_categories_category_name_key" UNIQUE (category_name);

ALTER TABLE ONLY "performance"."performance_categories"
    ADD CONSTRAINT "performance_categories_pkey" PRIMARY KEY (id);
