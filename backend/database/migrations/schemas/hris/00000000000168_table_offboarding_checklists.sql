-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.offboarding_checklists
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:30.978Z
-- =============================================================================

-- Table: hris.offboarding_checklists
CREATE TABLE "hris"."offboarding_checklists" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "employee_id" uuid NOT NULL,
    "resignation_type" resignation_type NOT NULL,
    "resignation_date" date NOT NULL,
    "last_working_day" date NOT NULL,
    "reason" text,
    "status" offboarding_status DEFAULT 'submitted'::offboarding_status NOT NULL,
    "exit_interview_date" date,
    "exit_interview_conducted_by" uuid,
    "exit_interview_notes" text,
    "final_payroll_date" date,
    "final_payroll_amount" numeric(12,2),
    "final_payroll_notes" text,
    "asset_return_status" jsonb DEFAULT '{}'::jsonb,
    "clearance_hrd" boolean DEFAULT false,
    "clearance_hrd_notes" text,
    "clearance_it" boolean DEFAULT false,
    "clearance_it_notes" text,
    "clearance_finance" boolean DEFAULT false,
    "clearance_finance_notes" text,
    "clearance_manager" boolean DEFAULT false,
    "clearance_manager_notes" text,
    "completed_at" timestamp with time zone,
    "completed_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."offboarding_checklists"
    ADD CONSTRAINT "offboarding_checklists_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "hris"."offboarding_checklists"
    ADD CONSTRAINT "offboarding_dates_valid" CHECK (last_working_day >= resignation_date);

CREATE INDEX idx_offboarding_dates ON hris.offboarding_checklists USING btree (resignation_date, last_working_day);

CREATE INDEX idx_offboarding_employee ON hris.offboarding_checklists USING btree (employee_id);

CREATE INDEX idx_offboarding_status ON hris.offboarding_checklists USING btree (status);

COMMENT ON TABLE "hris"."offboarding_checklists" IS 'Checklist resign/termination dengan asset return';
COMMENT ON COLUMN "hris"."offboarding_checklists"."asset_return_status" IS 'JSON object tracking asset return: {laptop: true, id_card: false, ...}';
