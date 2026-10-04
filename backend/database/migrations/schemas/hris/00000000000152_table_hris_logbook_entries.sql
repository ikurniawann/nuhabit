-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.hris_logbook_entries
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:21.182Z
-- =============================================================================

-- Table: hris.hris_logbook_entries
CREATE TABLE "hris"."hris_logbook_entries" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "template_id" uuid,
    "department_id" uuid NOT NULL,
    "entry_date" date DEFAULT CURRENT_DATE NOT NULL,
    "title" character varying(180) NOT NULL,
    "status" character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    "completion_percentage" numeric(6,2) DEFAULT 0 NOT NULL,
    "kpi_score" numeric(6,2) DEFAULT 0 NOT NULL,
    "notes" text,
    "submitted_by" uuid,
    "submitted_at" timestamp with time zone,
    "reviewed_by" uuid,
    "reviewed_at" timestamp with time zone,
    "review_notes" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."hris_logbook_entries"
    ADD CONSTRAINT "hris_logbook_entries_department_id_template_id_entry_date_key" UNIQUE (department_id, template_id, entry_date);

ALTER TABLE ONLY "hris"."hris_logbook_entries"
    ADD CONSTRAINT "hris_logbook_entries_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "hris"."hris_logbook_entries"
    ADD CONSTRAINT "hris_logbook_entries_status_check" CHECK (status::text = ANY (ARRAY['draft'::character varying, 'submitted'::character varying, 'reviewed'::character varying, 'rejected'::character varying]::text[]));

CREATE INDEX idx_hris_logbook_entries_department_date ON hris.hris_logbook_entries USING btree (department_id, entry_date DESC);

CREATE INDEX idx_hris_logbook_entries_status ON hris.hris_logbook_entries USING btree (status);

COMMENT ON TABLE "hris"."hris_logbook_entries" IS 'Logbook aktual per department/tanggal hasil generate dari template';
