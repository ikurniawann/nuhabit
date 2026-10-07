-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.kpi_templates
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:27.356Z
-- =============================================================================

-- Table: performance.kpi_templates
CREATE TABLE "performance"."kpi_templates" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "template_name" character varying(255) NOT NULL,
    "department_id" uuid,
    "position_id" uuid,
    "applicable_period" character varying(100),
    "effective_date" date,
    "expiry_date" date,
    "status" character varying(50) DEFAULT 'draft'::character varying,
    "is_active" boolean DEFAULT true,
    "total_weight" numeric(5,2) DEFAULT 100,
    "behavioral_weight" numeric(5,2) DEFAULT 20,
    "project_weight" numeric(5,2) DEFAULT 10,
    "created_by" uuid,
    "approved_by" uuid,
    "approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "performance"."kpi_templates"
    ADD CONSTRAINT "kpi_templates_pkey" PRIMARY KEY (id);

CREATE INDEX idx_kpi_templates_department ON performance.kpi_templates USING btree (department_id);

CREATE INDEX idx_kpi_templates_position ON performance.kpi_templates USING btree (position_id);

CREATE INDEX idx_kpi_templates_status ON performance.kpi_templates USING btree (status);
