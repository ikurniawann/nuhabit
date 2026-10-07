-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.benefits
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:48.420Z
-- =============================================================================

-- Table: hris.benefits
CREATE TABLE "hris"."benefits" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "type" text NOT NULL,
    "description" text,
    "coverage_amount" numeric(12,2),
    "coverage_percentage" numeric(5,2),
    "employee_contribution" numeric(5,2) DEFAULT 0,
    "employer_contribution" numeric(5,2) DEFAULT 100,
    "min_tenure_months" integer DEFAULT 0,
    "eligible_employment_status" text[],
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "hris"."benefits"
    ADD CONSTRAINT "benefits_pkey" PRIMARY KEY (id);

CREATE INDEX idx_benefits_active ON hris.benefits USING btree (is_active);

COMMENT ON TABLE "hris"."benefits" IS 'Company benefits catalog (insurance, wellness, pension)';
