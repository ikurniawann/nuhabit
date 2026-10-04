-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.payroll_details
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:32.207Z
-- =============================================================================

-- Table: hris.payroll_details
CREATE TABLE "hris"."payroll_details" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "payroll_run_id" uuid NOT NULL,
    "employee_id" uuid NOT NULL,
    "base_salary" numeric(12,2) DEFAULT 0,
    "fixed_allowance" numeric(12,2) DEFAULT 0,
    "variable_allowance" numeric(12,2) DEFAULT 0,
    "transport_allowance" numeric(12,2) DEFAULT 0,
    "meal_allowance" numeric(12,2) DEFAULT 0,
    "housing_allowance" numeric(12,2) DEFAULT 0,
    "overtime_pay" numeric(12,2) DEFAULT 0,
    "thr" numeric(12,2) DEFAULT 0,
    "bonus" numeric(12,2) DEFAULT 0,
    "other_earning" numeric(12,2) DEFAULT 0,
    "bpjs_tk_jht_deduction" numeric(12,2) DEFAULT 0,
    "bpjs_tk_jp_deduction" numeric(12,2) DEFAULT 0,
    "bpjs_kes_deduction" numeric(12,2) DEFAULT 0,
    "tapera_deduction" numeric(12,2) DEFAULT 0,
    "pph21_deduction" numeric(12,2) DEFAULT 0,
    "loan_deduction" numeric(12,2) DEFAULT 0,
    "unpaid_leave_deduction" numeric(12,2) DEFAULT 0,
    "other_deduction" numeric(12,2) DEFAULT 0,
    "gross_salary" numeric(12,2) DEFAULT 0,
    "total_deductions" numeric(12,2) DEFAULT 0,
    "net_salary" numeric(12,2) DEFAULT 0,
    "working_days" integer DEFAULT 0,
    "present_days" integer DEFAULT 0,
    "late_days" integer DEFAULT 0,
    "unpaid_leave_days" integer DEFAULT 0,
    "overtime_hours" numeric(6,2) DEFAULT 0,
    "bpjs_tk_jht_employer" numeric(12,2) DEFAULT 0,
    "bpjs_tk_jp_employer" numeric(12,2) DEFAULT 0,
    "bpjs_tk_jkk_employer" numeric(12,2) DEFAULT 0,
    "bpjs_tk_jkm_employer" numeric(12,2) DEFAULT 0,
    "bpjs_kes_employer" numeric(12,2) DEFAULT 0,
    "tapera_employer" numeric(12,2) DEFAULT 0,
    "taxable_income" numeric(12,2) DEFAULT 0,
    "ptkp_amount" numeric(12,2) DEFAULT 0,
    "pph21_annual" numeric(12,2) DEFAULT 0,
    "pph21_monthly" numeric(12,2) DEFAULT 0,
    "status" text DEFAULT 'calculated'::text,
    "payslip_sent" boolean DEFAULT false,
    "payslip_sent_at" timestamp with time zone,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "hris"."payroll_details"
    ADD CONSTRAINT "payroll_details_pkey" PRIMARY KEY (id);

CREATE INDEX idx_payroll_details_employee ON hris.payroll_details USING btree (employee_id);

CREATE INDEX idx_payroll_details_run ON hris.payroll_details USING btree (payroll_run_id);

COMMENT ON TABLE "hris"."payroll_details" IS 'Per-employee payroll calculation details within a run';
