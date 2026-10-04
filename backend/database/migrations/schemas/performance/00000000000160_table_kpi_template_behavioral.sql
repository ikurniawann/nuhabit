-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.kpi_template_behavioral
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:26.145Z
-- =============================================================================

-- Table: performance.kpi_template_behavioral
CREATE TABLE "performance"."kpi_template_behavioral" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "template_id" uuid NOT NULL,
    "value_name" character varying(100) NOT NULL,
    "competency" character varying(255),
    "behavioral_standard" text,
    "weight" numeric(5,2) DEFAULT 0,
    "score_5_description" text,
    "score_4_description" text,
    "score_3_description" text,
    "score_2_description" text,
    "score_1_description" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "performance"."kpi_template_behavioral"
    ADD CONSTRAINT "kpi_template_behavioral_pkey" PRIMARY KEY (id);

CREATE INDEX idx_kpi_template_behavioral_template ON performance.kpi_template_behavioral USING btree (template_id);
