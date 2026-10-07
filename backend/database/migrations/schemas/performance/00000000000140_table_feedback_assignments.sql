-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.feedback_assignments
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:10.283Z
-- =============================================================================

-- Table: performance.feedback_assignments
CREATE TABLE "performance"."feedback_assignments" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "cycle_id" uuid NOT NULL,
    "employee_id" uuid NOT NULL,
    "reviewer_id" uuid,
    "relationship_type" character varying(50) NOT NULL,
    "status" character varying(50) DEFAULT 'pending'::character varying,
    "due_date" date,
    "started_at" timestamp with time zone,
    "submitted_at" timestamp with time zone,
    "reminder_count" integer DEFAULT 0,
    "last_reminder_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now(),
    "manager_comments" text,
    "approved_by" uuid,
    "approved_at" timestamp with time zone,
    "rejection_reason" text
);

ALTER TABLE ONLY "performance"."feedback_assignments"
    ADD CONSTRAINT "feedback_assignments_cycle_id_employee_id_reviewer_id_relat_key" UNIQUE (cycle_id, employee_id, reviewer_id, relationship_type);

ALTER TABLE ONLY "performance"."feedback_assignments"
    ADD CONSTRAINT "feedback_assignments_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "performance"."feedback_assignments"
    ADD CONSTRAINT "check_assignment_status" CHECK (status::text = ANY (ARRAY['pending'::character varying, 'in_progress'::character varying, 'submitted'::character varying, 'approved'::character varying, 'rejected'::character varying]::text[]));

CREATE INDEX idx_feedback_assignments_approval ON performance.feedback_assignments USING btree (approved_at, status);

CREATE INDEX idx_feedback_assignments_cycle ON performance.feedback_assignments USING btree (cycle_id);

CREATE INDEX idx_feedback_assignments_employee ON performance.feedback_assignments USING btree (employee_id);

CREATE INDEX idx_feedback_assignments_reviewer ON performance.feedback_assignments USING btree (reviewer_id);

CREATE INDEX idx_feedback_assignments_status ON performance.feedback_assignments USING btree (status);

COMMENT ON TABLE "performance"."feedback_assignments" IS 'Mapping siapa menilai siapa dalam cycle';
