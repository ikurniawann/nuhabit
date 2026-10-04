-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.employee_kpis
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:06.147Z
-- =============================================================================

-- Table: hris.employee_kpis
CREATE TABLE "hris"."employee_kpis" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "review_id" uuid NOT NULL,
    "template_item_id" uuid,
    "employee_id" uuid NOT NULL,
    "perspective" character varying(100),
    "category" character varying(100),
    "kpi_name" character varying(255) NOT NULL,
    "kpi_definition" text,
    "formula" text,
    "target_value" numeric(10,2) DEFAULT 0,
    "measurement_unit" character varying(50),
    "weight" numeric(5,2) DEFAULT 0,
    "frequency" character varying(50),
    "actual_value" numeric(10,2) DEFAULT 0,
    "quality_actual" numeric(5,2) DEFAULT 0,
    "quantity_actual" numeric(5,2) DEFAULT 0,
    "timeliness_actual" numeric(5,2) DEFAULT 0,
    "achievement_percentage" numeric(6,2) DEFAULT 0,
    "score" integer,
    "score_label" character varying(50),
    "weighted_score" numeric(6,2) DEFAULT 0,
    "reviewer_notes" text,
    "employee_comments" text,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" uuid,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "target_text" text
);

ALTER TABLE ONLY "hris"."employee_kpis"
    ADD CONSTRAINT "employee_kpis_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "hris"."employee_kpis"
    ADD CONSTRAINT "employee_kpis_score_check" CHECK (score >= 1 AND score <= 5);

CREATE INDEX idx_employee_kpis_employee ON hris.employee_kpis USING btree (employee_id);

CREATE INDEX idx_employee_kpis_review ON hris.employee_kpis USING btree (review_id);

CREATE INDEX idx_employee_kpis_template_item ON hris.employee_kpis USING btree (template_item_id);
