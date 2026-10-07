-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.leaves
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:28.535Z
-- =============================================================================

-- Table: hris.leaves
CREATE TABLE "hris"."leaves" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "employee_id" uuid NOT NULL,
    "leave_type" leave_type NOT NULL,
    "start_date" date NOT NULL,
    "end_date" date NOT NULL,
    "total_days" numeric(5,2) NOT NULL,
    "reason" text NOT NULL,
    "attachment_url" text,
    "status" leave_status DEFAULT 'pending'::leave_status NOT NULL,
    "approved_by" uuid,
    "approved_at" timestamp with time zone,
    "rejection_reason" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."leaves"
    ADD CONSTRAINT "leaves_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "hris"."leaves"
    ADD CONSTRAINT "leave_dates_valid" CHECK (end_date >= start_date);

ALTER TABLE ONLY "hris"."leaves"
    ADD CONSTRAINT "total_days_positive" CHECK (total_days > 0::numeric);

CREATE INDEX idx_leaves_created ON hris.leaves USING btree (created_at);

CREATE INDEX idx_leaves_dates ON hris.leaves USING btree (start_date, end_date);

CREATE INDEX idx_leaves_employee ON hris.leaves USING btree (employee_id);

CREATE INDEX idx_leaves_status ON hris.leaves USING btree (status);

CREATE INDEX idx_leaves_type ON hris.leaves USING btree (leave_type);

COMMENT ON TABLE "hris"."leaves" IS 'Pengajuan cuti/izin/sakit dengan approval workflow';
COMMENT ON COLUMN "hris"."leaves"."total_days" IS 'Total hari cuti (exclude weekends)';
