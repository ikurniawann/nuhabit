-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.leave_balances
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:27.947Z
-- =============================================================================

-- Table: hris.leave_balances
CREATE TABLE "hris"."leave_balances" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "employee_id" uuid NOT NULL,
    "year" integer NOT NULL,
    "annual_leave_total" numeric(5,2) DEFAULT 12 NOT NULL,
    "annual_leave_used" numeric(5,2) DEFAULT 0 NOT NULL,
    "annual_leave_remaining" numeric(5,2) GENERATED ALWAYS AS (annual_leave_total - annual_leave_used) STORED,
    "sick_leave_used" numeric(5,2) DEFAULT 0 NOT NULL,
    "unpaid_leave_used" numeric(5,2) DEFAULT 0 NOT NULL,
    "maternity_leave_used" numeric(5,2) DEFAULT 0 NOT NULL,
    "paternity_leave_used" numeric(5,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "emergency_leave_used" integer DEFAULT 0 NOT NULL,
    "pilgrimage_leave_used" integer DEFAULT 0 NOT NULL,
    "menstrual_leave_used" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "hris"."leave_balances"
    ADD CONSTRAINT "leave_balance_unique" UNIQUE (employee_id, year);

ALTER TABLE ONLY "hris"."leave_balances"
    ADD CONSTRAINT "leave_balances_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "hris"."leave_balances"
    ADD CONSTRAINT "annual_leave_non_negative" CHECK (annual_leave_remaining >= 0::numeric);

ALTER TABLE ONLY "hris"."leave_balances"
    ADD CONSTRAINT "leave_balance_year_valid" CHECK (year >= 2020);

CREATE INDEX idx_leave_balances_employee ON hris.leave_balances USING btree (employee_id);

CREATE INDEX idx_leave_balances_year ON hris.leave_balances USING btree (year);

COMMENT ON TABLE "hris"."leave_balances" IS 'Quota cuti tahunan per karyawan per tahun';
