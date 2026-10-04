-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.payroll_settings
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:33.382Z
-- =============================================================================

-- Table: hris.payroll_settings
CREATE TABLE "hris"."payroll_settings" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "company_name" text NOT NULL,
    "npwp" text,
    "currency" text DEFAULT 'IDR'::text,
    "bpjs_tk_jht_employee" numeric(5,2) DEFAULT 2.00,
    "bpjs_tk_jht_employer" numeric(5,2) DEFAULT 3.70,
    "bpjs_tk_jp_employee" numeric(5,2) DEFAULT 1.00,
    "bpjs_tk_jp_employer" numeric(5,2) DEFAULT 2.00,
    "bpjs_tk_jkk" numeric(5,2) DEFAULT 0.24,
    "bpjs_tk_jkm" numeric(5,2) DEFAULT 0.30,
    "bpjs_kes_employee" numeric(5,2) DEFAULT 1.00,
    "bpjs_kes_employer" numeric(5,2) DEFAULT 4.00,
    "bpjs_kes_max_upah" numeric(12,2) DEFAULT 12000000,
    "tapera_employee" numeric(5,2) DEFAULT 2.50,
    "tapera_employer" numeric(5,2) DEFAULT 0.50,
    "pph21_bracket_1" numeric(12,2) DEFAULT 60000000,
    "pph21_bracket_2" numeric(12,2) DEFAULT 250000000,
    "pph21_bracket_3" numeric(12,2) DEFAULT 500000000,
    "pph21_bracket_4" numeric(12,2) DEFAULT '5000000000'::bigint,
    "pph21_bracket_5" numeric(12,2) DEFAULT '5000000000'::bigint,
    "ptkp_tk_0" numeric(12,2) DEFAULT 54000000,
    "ptkp_tk_1" numeric(12,2) DEFAULT 58500000,
    "ptkp_tk_2" numeric(12,2) DEFAULT 63000000,
    "ptkp_tk_3" numeric(12,2) DEFAULT 67500000,
    "ptkp_k_0" numeric(12,2) DEFAULT 58500000,
    "ptkp_k_1" numeric(12,2) DEFAULT 63000000,
    "ptkp_k_2" numeric(12,2) DEFAULT 67500000,
    "ptkp_k_3" numeric(12,2) DEFAULT 72000000,
    "thr_eligible_months" integer DEFAULT 12,
    "thr_prorate" boolean DEFAULT true,
    "payroll_day" integer DEFAULT 25,
    "overtime_multiplier" numeric(5,2) DEFAULT 1.5,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "hris"."payroll_settings"
    ADD CONSTRAINT "payroll_settings_pkey" PRIMARY KEY (id);

COMMENT ON TABLE "hris"."payroll_settings" IS 'Company-wide payroll configuration including BPJS rates, PTKP, and PPh 21 brackets';
