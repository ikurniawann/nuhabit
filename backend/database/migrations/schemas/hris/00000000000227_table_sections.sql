-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.sections
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:07.050Z
-- =============================================================================

-- Table: hris.sections
CREATE TABLE "hris"."sections" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "brand_id" uuid NOT NULL,
    "name" text NOT NULL,
    "code" text NOT NULL,
    "description" text,
    "color" text DEFAULT '#6B7280'::text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."sections"
    ADD CONSTRAINT "sections_pkey" PRIMARY KEY (id);

CREATE INDEX idx_sections_brand ON hris.sections USING btree (brand_id);
