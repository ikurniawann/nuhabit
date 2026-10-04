-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.employee_salary
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:06.738Z
-- =============================================================================

-- Table: hris.employee_salary
CREATE TABLE "hris"."employee_salary" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "employee_id" uuid NOT NULL,
    "base_salary" numeric(12,2) NOT NULL,
    "fixed_allowance" numeric(12,2) DEFAULT 0,
    "variable_allowance" numeric(12,2) DEFAULT 0,
    "transport_allowance" numeric(12,2) DEFAULT 0,
    "meal_allowance" numeric(12,2) DEFAULT 0,
    "housing_allowance" numeric(12,2) DEFAULT 0,
    "loan_deduction" numeric(12,2) DEFAULT 0,
    "other_deduction" numeric(12,2) DEFAULT 0,
    "ptkp_status" text DEFAULT 'TK/0'::text,
    "is_taxable" boolean DEFAULT true,
    "bpjs_tk_enrolled" boolean DEFAULT true,
    "bpjs_kes_enrolled" boolean DEFAULT true,
    "tapera_enrolled" boolean DEFAULT true,
    "effective_date" date DEFAULT CURRENT_DATE NOT NULL,
    "end_date" date,
    "is_active" boolean DEFAULT true,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "hris"."employee_salary"
    ADD CONSTRAINT "unique_employee_salary" UNIQUE (employee_id, effective_date);

ALTER TABLE ONLY "hris"."employee_salary"
    ADD CONSTRAINT "employee_salary_pkey" PRIMARY KEY (id);

CREATE INDEX idx_employee_salary_active ON hris.employee_salary USING btree (is_active);

CREATE INDEX idx_employee_salary_employee ON hris.employee_salary USING btree (employee_id);

COMMENT ON TABLE "hris"."employee_salary" IS 'Salary structure per employee with fixed and variable components';
