-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.performance_reviews
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:35.144Z
-- =============================================================================

-- Table: performance.performance_reviews
CREATE TABLE "performance"."performance_reviews" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "kpi_template_id" uuid,
    "employee_id" uuid NOT NULL,
    "employee_department_id" uuid,
    "employee_position_id" uuid,
    "period_label" character varying(100) NOT NULL,
    "start_date" date NOT NULL,
    "end_date" date NOT NULL,
    "total_work_result_score" numeric(6,2) DEFAULT 0,
    "total_behavioral_score" numeric(6,2) DEFAULT 0,
    "total_project_score" numeric(6,2) DEFAULT 0,
    "grand_total_score" numeric(6,2) DEFAULT 0,
    "category" character varying(50),
    "status" character varying(50) DEFAULT 'draft'::character varying,
    "reviewer_id" uuid,
    "reviewer_name" character varying(255),
    "reviewer_position" character varying(255),
    "manager_id" uuid,
    "reviewee_sign_date" date,
    "reviewer_sign_date" date,
    "employee_sign_date" date,
    "self_assessment" text,
    "reviewer_notes" text,
    "manager_notes" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "performance"."performance_reviews"
    ADD CONSTRAINT "performance_reviews_pkey" PRIMARY KEY (id);

CREATE INDEX idx_performance_reviews_employee ON performance.performance_reviews USING btree (employee_id);

CREATE INDEX idx_performance_reviews_period ON performance.performance_reviews USING btree (period_label);

CREATE INDEX idx_performance_reviews_status ON performance.performance_reviews USING btree (status);

CREATE INDEX idx_performance_reviews_template ON performance.performance_reviews USING btree (kpi_template_id);
