-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.development_plans
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:04.373Z
-- =============================================================================

-- Table: hris.development_plans
CREATE TABLE "hris"."development_plans" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "review_id" uuid NOT NULL,
    "employee_id" uuid NOT NULL,
    "competency_area" character varying(255),
    "development_action" text NOT NULL,
    "target_completion_date" date,
    "status" character varying(50) DEFAULT 'planned'::character varying,
    "progress_percentage" integer DEFAULT 0,
    "completed_at" timestamp with time zone,
    "resources_required" text,
    "estimated_cost" numeric(12,2),
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "hris"."development_plans"
    ADD CONSTRAINT "development_plans_pkey" PRIMARY KEY (id);

CREATE INDEX idx_development_plans_employee ON hris.development_plans USING btree (employee_id);

CREATE INDEX idx_development_plans_review ON hris.development_plans USING btree (review_id);
