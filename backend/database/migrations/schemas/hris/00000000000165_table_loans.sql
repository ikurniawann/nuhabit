-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.loans
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:29.144Z
-- =============================================================================

-- Table: hris.loans
CREATE TABLE "hris"."loans" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "employee_id" uuid NOT NULL,
    "loan_type" text NOT NULL,
    "principal_amount" numeric(12,2) NOT NULL,
    "interest_rate" numeric(5,2) DEFAULT 0,
    "tenor_months" integer NOT NULL,
    "requested_date" timestamp with time zone DEFAULT now(),
    "approved_by" uuid,
    "approved_at" timestamp with time zone,
    "rejected_by" uuid,
    "rejected_at" timestamp with time zone,
    "rejection_reason" text,
    "disbursed_at" timestamp with time zone,
    "disbursed_amount" numeric(12,2),
    "monthly_installment" numeric(12,2) DEFAULT 0,
    "first_installment_month" integer,
    "first_installment_year" integer,
    "remaining_balance" numeric(12,2),
    "paid_amount" numeric(12,2) DEFAULT 0,
    "status" text DEFAULT 'pending'::text,
    "is_active" boolean DEFAULT true,
    "purpose" text,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "hris"."loans"
    ADD CONSTRAINT "loans_pkey" PRIMARY KEY (id);

CREATE INDEX idx_loans_employee ON hris.loans USING btree (employee_id);

CREATE INDEX idx_loans_status ON hris.loans USING btree (status);

COMMENT ON TABLE "hris"."loans" IS 'Employee loans and salary advances';
