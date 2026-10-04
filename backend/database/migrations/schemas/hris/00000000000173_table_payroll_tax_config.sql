-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.payroll_tax_config
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:33.978Z
-- =============================================================================

-- Table: hris.payroll_tax_config
CREATE TABLE "hris"."payroll_tax_config" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "tax_year" integer NOT NULL,
    "ptkp_tk_0" numeric(12,2) DEFAULT 54000000,
    "ptkp_tk_1" numeric(12,2) DEFAULT 58500000,
    "ptkp_tk_2" numeric(12,2) DEFAULT 63000000,
    "ptkp_tk_3" numeric(12,2) DEFAULT 67500000,
    "ptkp_k_0" numeric(12,2) DEFAULT 58500000,
    "ptkp_k_1" numeric(12,2) DEFAULT 63000000,
    "ptkp_k_2" numeric(12,2) DEFAULT 67500000,
    "ptkp_k_3" numeric(12,2) DEFAULT 72000000,
    "bracket_1_limit" numeric(12,2) DEFAULT 60000000,
    "bracket_1_rate" numeric(5,2) DEFAULT 5.00,
    "bracket_2_limit" numeric(12,2) DEFAULT 250000000,
    "bracket_2_rate" numeric(5,2) DEFAULT 15.00,
    "bracket_3_limit" numeric(12,2) DEFAULT 500000000,
    "bracket_3_rate" numeric(5,2) DEFAULT 25.00,
    "bracket_4_limit" numeric(12,2) DEFAULT '5000000000'::bigint,
    "bracket_4_rate" numeric(5,2) DEFAULT 30.00,
    "bracket_5_rate" numeric(5,2) DEFAULT 35.00,
    "jabatan_expense_percentage" numeric(5,2) DEFAULT 5.00,
    "jabatan_expense_max" numeric(12,2) DEFAULT 6000000,
    "pension_deduction_percentage" numeric(5,2) DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "hris"."payroll_tax_config"
    ADD CONSTRAINT "payroll_tax_config_tax_year_key" UNIQUE (tax_year);

ALTER TABLE ONLY "hris"."payroll_tax_config"
    ADD CONSTRAINT "payroll_tax_config_pkey" PRIMARY KEY (id);

COMMENT ON TABLE "hris"."payroll_tax_config" IS 'Annual PPh 21 ETR configuration including PTKP and tax brackets';
