-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: recruitment.candidates
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:52.238Z
-- =============================================================================

-- Table: recruitment.candidates
CREATE TABLE "recruitment"."candidates" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "full_name" text NOT NULL,
    "email" text NOT NULL,
    "phone" text NOT NULL,
    "domicile" text NOT NULL,
    "source" text NOT NULL,
    "position_id" uuid,
    "brand_id" uuid,
    "cv_url" text,
    "photo_url" text,
    "status" text DEFAULT 'new'::text NOT NULL,
    "notes" text,
    "created_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "promoted_to_employee_id" uuid,
    "promotion_date" timestamp with time zone,
    "job_opening_id" uuid,
    "last_experience" text,
    "last_education" text,
    "availability" character varying(20),
    "expected_salary" integer
);

ALTER TABLE ONLY "recruitment"."candidates"
    ADD CONSTRAINT "candidates_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "recruitment"."candidates"
    ADD CONSTRAINT "candidates_status_check" CHECK (status = ANY (ARRAY['new'::text, 'screening'::text, 'interview_hrd'::text, 'interview_manager'::text, 'talent_pool'::text, 'hired'::text, 'rejected'::text]));

CREATE INDEX idx_candidates_availability ON recruitment.candidates USING btree (availability);

CREATE INDEX idx_candidates_brand ON recruitment.candidates USING btree (brand_id);

CREATE INDEX idx_candidates_created_by ON recruitment.candidates USING btree (created_by);

CREATE INDEX idx_candidates_job_opening ON recruitment.candidates USING btree (job_opening_id);

CREATE INDEX idx_candidates_position ON recruitment.candidates USING btree (position_id);

CREATE INDEX idx_candidates_promoted ON recruitment.candidates USING btree (promoted_to_employee_id);

CREATE INDEX idx_candidates_status ON recruitment.candidates USING btree (status);
COMMENT ON COLUMN "recruitment"."candidates"."last_experience" IS 'Last work experience: Company Name - Position (Duration)';
COMMENT ON COLUMN "recruitment"."candidates"."last_education" IS 'Last education: Degree - Major - Institution';
COMMENT ON COLUMN "recruitment"."candidates"."availability" IS 'Availability to join: immediate, 1_week, 2_weeks, 1_month';
COMMENT ON COLUMN "recruitment"."candidates"."expected_salary" IS 'Expected salary in IDR';
