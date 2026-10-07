-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.feedback_responses
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:15.513Z
-- =============================================================================

-- Table: performance.feedback_responses
CREATE TABLE "performance"."feedback_responses" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "assignment_id" uuid NOT NULL,
    "criteria_id" uuid NOT NULL,
    "rating" integer NOT NULL,
    "comments" text,
    "sentiment_score" numeric(5,2),
    "sentiment_label" character varying(20),
    "ai_keywords" text[],
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "performance"."feedback_responses"
    ADD CONSTRAINT "feedback_responses_assignment_id_criteria_id_key" UNIQUE (assignment_id, criteria_id);

ALTER TABLE ONLY "performance"."feedback_responses"
    ADD CONSTRAINT "feedback_responses_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "performance"."feedback_responses"
    ADD CONSTRAINT "feedback_responses_rating_check" CHECK (rating >= 1 AND rating <= 5);

CREATE INDEX idx_feedback_responses_assignment ON performance.feedback_responses USING btree (assignment_id);

CREATE INDEX idx_feedback_responses_criteria ON performance.feedback_responses USING btree (criteria_id);

CREATE INDEX idx_feedback_responses_sentiment ON performance.feedback_responses USING btree (sentiment_label);

COMMENT ON TABLE "performance"."feedback_responses" IS 'Jawaban/rating per criteria dari reviewer';
