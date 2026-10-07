-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.payroll_runs
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:32.796Z
-- =============================================================================

-- Table: hris.payroll_runs
CREATE TABLE "hris"."payroll_runs" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "run_name" text NOT NULL,
    "period_month" integer NOT NULL,
    "period_year" integer NOT NULL,
    "status" text DEFAULT 'draft'::text NOT NULL,
    "processed_by" uuid,
    "processed_at" timestamp with time zone,
    "approved_by" uuid,
    "approved_at" timestamp with time zone,
    "paid_at" timestamp with time zone,
    "total_employees" integer DEFAULT 0,
    "total_gross" numeric(14,2) DEFAULT 0,
    "total_deductions" numeric(14,2) DEFAULT 0,
    "total_net" numeric(14,2) DEFAULT 0,
    "total_bjtk_employee" numeric(14,2) DEFAULT 0,
    "total_bjtk_employer" numeric(14,2) DEFAULT 0,
    "total_pph21" numeric(14,2) DEFAULT 0,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "hris"."payroll_runs"
    ADD CONSTRAINT "unique_period" UNIQUE (period_month, period_year);

ALTER TABLE ONLY "hris"."payroll_runs"
    ADD CONSTRAINT "payroll_runs_pkey" PRIMARY KEY (id);

CREATE INDEX idx_payroll_runs_period ON hris.payroll_runs USING btree (period_year, period_month);

CREATE INDEX idx_payroll_runs_status ON hris.payroll_runs USING btree (status);

COMMENT ON TABLE "hris"."payroll_runs" IS 'Monthly payroll processing runs';
