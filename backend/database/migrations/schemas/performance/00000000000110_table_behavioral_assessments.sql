-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.behavioral_assessments
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:46.307Z
-- =============================================================================

-- Table: performance.behavioral_assessments
CREATE TABLE "performance"."behavioral_assessments" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "review_id" uuid NOT NULL,
    "employee_id" uuid NOT NULL,
    "caring_score" integer,
    "caring_notes" text,
    "credible_score" integer,
    "credible_notes" text,
    "competent_score" integer,
    "competent_notes" text,
    "competitive_score" integer,
    "competitive_notes" text,
    "customer_delight_score" integer,
    "customer_delight_notes" text,
    "total_score" numeric(6,2) DEFAULT 0,
    "weighted_score" numeric(6,2) DEFAULT 0,
    "assessed_by" uuid,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "performance"."behavioral_assessments"
    ADD CONSTRAINT "behavioral_assessments_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "performance"."behavioral_assessments"
    ADD CONSTRAINT "behavioral_assessments_caring_score_check" CHECK (caring_score >= 1 AND caring_score <= 5);

ALTER TABLE ONLY "performance"."behavioral_assessments"
    ADD CONSTRAINT "behavioral_assessments_competent_score_check" CHECK (competent_score >= 1 AND competent_score <= 5);

ALTER TABLE ONLY "performance"."behavioral_assessments"
    ADD CONSTRAINT "behavioral_assessments_competitive_score_check" CHECK (competitive_score >= 1 AND competitive_score <= 5);

ALTER TABLE ONLY "performance"."behavioral_assessments"
    ADD CONSTRAINT "behavioral_assessments_credible_score_check" CHECK (credible_score >= 1 AND credible_score <= 5);

ALTER TABLE ONLY "performance"."behavioral_assessments"
    ADD CONSTRAINT "behavioral_assessments_customer_delight_score_check" CHECK (customer_delight_score >= 1 AND customer_delight_score <= 5);

CREATE INDEX idx_behavioral_assessments_employee ON performance.behavioral_assessments USING btree (employee_id);

CREATE INDEX idx_behavioral_assessments_review ON performance.behavioral_assessments USING btree (review_id);
