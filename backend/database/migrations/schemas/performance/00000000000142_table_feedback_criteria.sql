-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.feedback_criteria
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:11.832Z
-- =============================================================================

-- Table: performance.feedback_criteria
CREATE TABLE "performance"."feedback_criteria" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "category_id" uuid NOT NULL,
    "name" character varying(200) NOT NULL,
    "description" text,
    "display_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "performance"."feedback_criteria"
    ADD CONSTRAINT "feedback_criteria_pkey" PRIMARY KEY (id);

CREATE INDEX idx_feedback_criteria_category ON performance.feedback_criteria USING btree (category_id);

COMMENT ON TABLE "performance"."feedback_criteria" IS 'Indikator/criteria per kategori untuk dinilai';
