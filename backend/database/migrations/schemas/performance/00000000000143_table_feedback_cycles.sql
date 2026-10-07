-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.feedback_cycles
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:13.077Z
-- =============================================================================

-- Table: performance.feedback_cycles
CREATE TABLE "performance"."feedback_cycles" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" character varying(200) NOT NULL,
    "period_label" character varying(100) NOT NULL,
    "start_date" date NOT NULL,
    "end_date" date NOT NULL,
    "status" character varying(50) DEFAULT 'draft'::character varying,
    "kpi_weight" numeric(5,2) DEFAULT 70.00,
    "feedback_weight" numeric(5,2) DEFAULT 30.00,
    "is_anonymous" boolean DEFAULT true,
    "allow_self_assessment" boolean DEFAULT true,
    "require_manager_review" boolean DEFAULT true,
    "created_by" uuid,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "performance"."feedback_cycles"
    ADD CONSTRAINT "feedback_cycles_pkey" PRIMARY KEY (id);

CREATE INDEX idx_feedback_cycles_period ON performance.feedback_cycles USING btree (period_label);

CREATE INDEX idx_feedback_cycles_status ON performance.feedback_cycles USING btree (status);

COMMENT ON TABLE "performance"."feedback_cycles" IS 'Periode feedback cycle (Q1, Q2, Annual, dll)';
