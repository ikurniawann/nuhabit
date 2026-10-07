-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.behavioral_standards
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:47.818Z
-- =============================================================================

-- Table: performance.behavioral_standards
CREATE TABLE "performance"."behavioral_standards" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "value_name" character varying(50) NOT NULL,
    "competency_name" character varying(100),
    "standard_description" text,
    "score_1_description" text,
    "score_2_description" text,
    "score_3_description" text,
    "score_4_description" text,
    "score_5_description" text,
    "weight" numeric(5,2) DEFAULT 0.03,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "performance"."behavioral_standards"
    ADD CONSTRAINT "behavioral_standards_pkey" PRIMARY KEY (id);
