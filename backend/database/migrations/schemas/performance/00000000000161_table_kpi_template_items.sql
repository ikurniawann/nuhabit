-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.kpi_template_items
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:26.750Z
-- =============================================================================

-- Table: performance.kpi_template_items
CREATE TABLE "performance"."kpi_template_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "template_id" uuid NOT NULL,
    "perspective" character varying(100),
    "category" character varying(100),
    "kpi_name" character varying(255) NOT NULL,
    "kpi_definition" text,
    "formula" text,
    "control_method" text,
    "target_value" numeric(10,2) DEFAULT 0,
    "measurement_unit" character varying(50),
    "weight" numeric(5,2) DEFAULT 0,
    "frequency" character varying(50),
    "score_5_description" text,
    "score_4_description" text,
    "score_3_description" text,
    "score_2_description" text,
    "score_1_description" text,
    "item_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "target_text" text
);

ALTER TABLE ONLY "performance"."kpi_template_items"
    ADD CONSTRAINT "kpi_template_items_pkey" PRIMARY KEY (id);

CREATE INDEX idx_kpi_template_items_template ON performance.kpi_template_items USING btree (template_id);
