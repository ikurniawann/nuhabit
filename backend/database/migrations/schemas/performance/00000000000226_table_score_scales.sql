-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.score_scales
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:06.451Z
-- =============================================================================

-- Table: performance.score_scales
CREATE TABLE "performance"."score_scales" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "score" integer NOT NULL,
    "label" character varying(50) NOT NULL,
    "quality_description" text,
    "quantity_min_percent" numeric(5,2),
    "quantity_max_percent" numeric(5,2),
    "time_description" text
);

ALTER TABLE ONLY "performance"."score_scales"
    ADD CONSTRAINT "score_scales_score_key" UNIQUE (score);

ALTER TABLE ONLY "performance"."score_scales"
    ADD CONSTRAINT "score_scales_pkey" PRIMARY KEY (id);
