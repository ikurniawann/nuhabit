-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: recruitment.job_openings
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:25.570Z
-- =============================================================================

-- Table: recruitment.job_openings
CREATE TABLE "recruitment"."job_openings" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "position_id" uuid,
    "brand_id" uuid,
    "department_id" uuid,
    "title" text NOT NULL,
    "slug" text NOT NULL,
    "department" text DEFAULT 'Operations'::text NOT NULL,
    "location" text DEFAULT 'Jakarta, ID'::text NOT NULL,
    "employment_type" text DEFAULT 'Full-time'::text NOT NULL,
    "work_mode" text DEFAULT 'On-site'::text NOT NULL,
    "headcount" integer DEFAULT 1 NOT NULL,
    "description" text,
    "requirements" text,
    "benefits" text,
    "status" text DEFAULT 'draft'::text NOT NULL,
    "published_at" timestamp with time zone,
    "closing_date" date,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "recruitment"."job_openings"
    ADD CONSTRAINT "job_openings_slug_key" UNIQUE (slug);

ALTER TABLE ONLY "recruitment"."job_openings"
    ADD CONSTRAINT "job_openings_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "recruitment"."job_openings"
    ADD CONSTRAINT "job_openings_headcount_check" CHECK (headcount > 0);

ALTER TABLE ONLY "recruitment"."job_openings"
    ADD CONSTRAINT "job_openings_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'closed'::text]));

CREATE INDEX idx_job_openings_brand ON recruitment.job_openings USING btree (brand_id);

CREATE INDEX idx_job_openings_department ON recruitment.job_openings USING btree (department_id);

CREATE INDEX idx_job_openings_position ON recruitment.job_openings USING btree (position_id);

CREATE INDEX idx_job_openings_slug ON recruitment.job_openings USING btree (slug);

CREATE INDEX idx_job_openings_status ON recruitment.job_openings USING btree (status);
