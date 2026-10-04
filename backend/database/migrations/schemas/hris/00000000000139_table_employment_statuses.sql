-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.employment_statuses
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:09.664Z
-- =============================================================================

-- Table: hris.employment_statuses
CREATE TABLE "hris"."employment_statuses" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "code" character varying(50) NOT NULL,
    "name" character varying(100) NOT NULL,
    "color" character varying(50) DEFAULT 'gray'::character varying,
    "description" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "hris"."employment_statuses"
    ADD CONSTRAINT "employment_statuses_code_key" UNIQUE (code);

ALTER TABLE ONLY "hris"."employment_statuses"
    ADD CONSTRAINT "employment_statuses_pkey" PRIMARY KEY (id);
