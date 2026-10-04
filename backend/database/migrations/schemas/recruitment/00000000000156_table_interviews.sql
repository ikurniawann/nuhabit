-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: recruitment.interviews
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:23.798Z
-- =============================================================================

-- Table: recruitment.interviews
CREATE TABLE "recruitment"."interviews" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "candidate_id" uuid NOT NULL,
    "interviewer_id" uuid,
    "interview_date" timestamp with time zone NOT NULL,
    "type" text NOT NULL,
    "scorecard" jsonb,
    "recommendation" text,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "mode" text DEFAULT 'offline'::text,
    "meeting_link" text
);

ALTER TABLE ONLY "recruitment"."interviews"
    ADD CONSTRAINT "interviews_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "recruitment"."interviews"
    ADD CONSTRAINT "interviews_recommendation_check" CHECK (recommendation = ANY (ARRAY['proceed'::text, 'pool'::text, 'reject'::text]));

ALTER TABLE ONLY "recruitment"."interviews"
    ADD CONSTRAINT "interviews_type_check" CHECK (type = ANY (ARRAY['hrd'::text, 'hiring_manager'::text]));

CREATE INDEX idx_interviews_candidate ON recruitment.interviews USING btree (candidate_id);

CREATE INDEX idx_interviews_interviewer ON recruitment.interviews USING btree (interviewer_id);
COMMENT ON COLUMN "recruitment"."interviews"."interviewer_id" IS 'Nullable - can schedule without specific interviewer';
