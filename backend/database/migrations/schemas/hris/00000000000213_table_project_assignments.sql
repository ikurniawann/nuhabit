-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.project_assignments
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:58.359Z
-- =============================================================================

-- Table: hris.project_assignments
CREATE TABLE "hris"."project_assignments" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "review_id" uuid NOT NULL,
    "employee_id" uuid NOT NULL,
    "project_name" character varying(255) NOT NULL,
    "project_description" text,
    "role_in_project" character varying(100),
    "target_score" numeric(6,2) DEFAULT 0,
    "actual_score" numeric(6,2) DEFAULT 0,
    "weight" numeric(5,2) DEFAULT 0,
    "weighted_score" numeric(6,2) DEFAULT 0,
    "start_date" date,
    "end_date" date,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "hris"."project_assignments"
    ADD CONSTRAINT "project_assignments_pkey" PRIMARY KEY (id);

CREATE INDEX idx_project_assignments_employee ON hris.project_assignments USING btree (employee_id);

CREATE INDEX idx_project_assignments_review ON hris.project_assignments USING btree (review_id);
