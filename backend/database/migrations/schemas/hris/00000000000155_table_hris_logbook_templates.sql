-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.hris_logbook_templates
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:23.202Z
-- =============================================================================

-- Table: hris.hris_logbook_templates
CREATE TABLE "hris"."hris_logbook_templates" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "department_id" uuid NOT NULL,
    "name" character varying(160) NOT NULL,
    "description" text,
    "frequency" character varying(20) DEFAULT 'daily'::character varying NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."hris_logbook_templates"
    ADD CONSTRAINT "hris_logbook_templates_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "hris"."hris_logbook_templates"
    ADD CONSTRAINT "hris_logbook_templates_frequency_check" CHECK (frequency::text = ANY (ARRAY['daily'::character varying, 'weekly'::character varying, 'monthly'::character varying, 'custom'::character varying]::text[]));

CREATE INDEX idx_hris_logbook_templates_department ON hris.hris_logbook_templates USING btree (department_id, is_active);

COMMENT ON TABLE "hris"."hris_logbook_templates" IS 'Template checklist logbook per department untuk KPI HRIS';
