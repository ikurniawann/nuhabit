-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.onboarding_checklists
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:31.571Z
-- =============================================================================

-- Table: hris.onboarding_checklists
CREATE TABLE "hris"."onboarding_checklists" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "employee_id" uuid NOT NULL,
    "task_name" text NOT NULL,
    "category" onboarding_category NOT NULL,
    "description" text,
    "priority" integer DEFAULT 3,
    "due_date" date,
    "due_days_after_join" integer DEFAULT 7,
    "completed" boolean DEFAULT false NOT NULL,
    "completed_at" timestamp with time zone,
    "completed_by" uuid,
    "completion_notes" text,
    "assigned_to" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."onboarding_checklists"
    ADD CONSTRAINT "onboarding_checklists_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "hris"."onboarding_checklists"
    ADD CONSTRAINT "priority_valid" CHECK (priority >= 1 AND priority <= 3);

CREATE INDEX idx_onboarding_category ON hris.onboarding_checklists USING btree (category);

CREATE INDEX idx_onboarding_completed ON hris.onboarding_checklists USING btree (completed);

CREATE INDEX idx_onboarding_due_date ON hris.onboarding_checklists USING btree (due_date);

CREATE INDEX idx_onboarding_employee ON hris.onboarding_checklists USING btree (employee_id);

COMMENT ON TABLE "hris"."onboarding_checklists" IS 'Checklist onboarding untuk karyawan baru';
