-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.employee_benefits
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:04.993Z
-- =============================================================================

-- Table: hris.employee_benefits
CREATE TABLE "hris"."employee_benefits" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "employee_id" uuid NOT NULL,
    "benefit_id" uuid NOT NULL,
    "enrolled_date" date DEFAULT CURRENT_DATE NOT NULL,
    "end_date" date,
    "coverage_amount" numeric(12,2),
    "policy_number" text,
    "employee_cost" numeric(12,2) DEFAULT 0,
    "employer_cost" numeric(12,2) DEFAULT 0,
    "status" text DEFAULT 'active'::text,
    "is_active" boolean DEFAULT true,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "hris"."employee_benefits"
    ADD CONSTRAINT "unique_employee_benefit" UNIQUE (employee_id, benefit_id);

ALTER TABLE ONLY "hris"."employee_benefits"
    ADD CONSTRAINT "employee_benefits_pkey" PRIMARY KEY (id);

CREATE INDEX idx_employee_benefits_active ON hris.employee_benefits USING btree (is_active);

CREATE INDEX idx_employee_benefits_employee ON hris.employee_benefits USING btree (employee_id);

COMMENT ON TABLE "hris"."employee_benefits" IS 'Employee enrollment in company benefits';
