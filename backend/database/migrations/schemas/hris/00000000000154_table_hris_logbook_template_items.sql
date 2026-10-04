-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.hris_logbook_template_items
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:22.606Z
-- =============================================================================

-- Table: hris.hris_logbook_template_items
CREATE TABLE "hris"."hris_logbook_template_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "template_id" uuid NOT NULL,
    "title" character varying(220) NOT NULL,
    "description" text,
    "weight" numeric(6,2) DEFAULT 1 NOT NULL,
    "is_required" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."hris_logbook_template_items"
    ADD CONSTRAINT "hris_logbook_template_items_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "hris"."hris_logbook_template_items"
    ADD CONSTRAINT "hris_logbook_template_items_weight_check" CHECK (weight >= 0::numeric);

CREATE INDEX idx_hris_logbook_template_items_template ON hris.hris_logbook_template_items USING btree (template_id, sort_order);
