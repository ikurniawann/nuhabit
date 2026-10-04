-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.feedback_summaries
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:16.416Z
-- =============================================================================

-- Table: performance.feedback_summaries
CREATE TABLE "performance"."feedback_summaries" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "cycle_id" uuid NOT NULL,
    "employee_id" uuid NOT NULL,
    "leadership_score" numeric(5,2),
    "communication_score" numeric(5,2),
    "collaboration_score" numeric(5,2),
    "accountability_score" numeric(5,2),
    "problem_solving_score" numeric(5,2),
    "overall_360_score" numeric(5,2),
    "kpi_score" numeric(5,2),
    "final_score" numeric(5,2),
    "final_grade" character varying(2),
    "manager_review_status" character varying(50) DEFAULT 'pending'::character varying,
    "manager_comments" text,
    "reviewed_by" uuid,
    "reviewed_at" timestamp with time zone,
    "strengths" text[],
    "weaknesses" text[],
    "burnout_risk" character varying(20),
    "promotion_potential" character varying(20),
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "is_locked" boolean DEFAULT false,
    "locked_at" timestamp with time zone,
    "locked_by" uuid
);

ALTER TABLE ONLY "performance"."feedback_summaries"
    ADD CONSTRAINT "feedback_summaries_cycle_id_employee_id_key" UNIQUE (cycle_id, employee_id);

ALTER TABLE ONLY "performance"."feedback_summaries"
    ADD CONSTRAINT "feedback_summaries_pkey" PRIMARY KEY (id);

CREATE INDEX idx_feedback_summaries_cycle ON performance.feedback_summaries USING btree (cycle_id);

CREATE INDEX idx_feedback_summaries_employee ON performance.feedback_summaries USING btree (employee_id);

CREATE INDEX idx_feedback_summaries_score ON performance.feedback_summaries USING btree (final_score);

COMMENT ON TABLE "performance"."feedback_summaries" IS 'Aggregated scores + AI insights per employee';
