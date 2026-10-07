-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.employment_history
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:09.016Z
-- =============================================================================

-- Table: hris.employment_history
CREATE TABLE "hris"."employment_history" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "employee_id" uuid NOT NULL,
    "change_type" character varying(50) NOT NULL,
    "effective_date" date NOT NULL,
    "prev_department_id" uuid,
    "prev_section_id" uuid,
    "prev_job_title_id" uuid,
    "prev_employment_status" character varying(50),
    "prev_salary" numeric(15,2),
    "new_department_id" uuid,
    "new_section_id" uuid,
    "new_job_title_id" uuid,
    "new_employment_status" character varying(50),
    "new_salary" numeric(15,2),
    "reason" text,
    "notes" text,
    "recorded_by" uuid,
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "hris"."employment_history"
    ADD CONSTRAINT "employment_history_pkey" PRIMARY KEY (id);

CREATE INDEX idx_employment_history_date ON hris.employment_history USING btree (effective_date);

CREATE INDEX idx_employment_history_employee ON hris.employment_history USING btree (employee_id);
