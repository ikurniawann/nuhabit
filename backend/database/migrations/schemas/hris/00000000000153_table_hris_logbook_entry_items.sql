-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.hris_logbook_entry_items
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:21.909Z
-- =============================================================================

-- Table: hris.hris_logbook_entry_items
CREATE TABLE "hris"."hris_logbook_entry_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "entry_id" uuid NOT NULL,
    "template_item_id" uuid,
    "title" character varying(220) NOT NULL,
    "description" text,
    "weight" numeric(6,2) DEFAULT 1 NOT NULL,
    "is_required" boolean DEFAULT true NOT NULL,
    "is_checked" boolean DEFAULT false NOT NULL,
    "checked_by" uuid,
    "checked_at" timestamp with time zone,
    "notes" text,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."hris_logbook_entry_items"
    ADD CONSTRAINT "hris_logbook_entry_items_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "hris"."hris_logbook_entry_items"
    ADD CONSTRAINT "hris_logbook_entry_items_weight_check" CHECK (weight >= 0::numeric);

CREATE INDEX idx_hris_logbook_entry_items_entry ON hris.hris_logbook_entry_items USING btree (entry_id, sort_order);
