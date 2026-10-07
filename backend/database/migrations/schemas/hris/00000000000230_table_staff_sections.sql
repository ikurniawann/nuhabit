-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.staff_sections
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:08.828Z
-- =============================================================================

-- Table: hris.staff_sections
CREATE TABLE "hris"."staff_sections" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "staff_id" uuid NOT NULL,
    "section_id" uuid NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."staff_sections"
    ADD CONSTRAINT "staff_sections_staff_id_section_id_key" UNIQUE (staff_id, section_id);

ALTER TABLE ONLY "hris"."staff_sections"
    ADD CONSTRAINT "staff_sections_pkey" PRIMARY KEY (id);

CREATE INDEX idx_staff_sections_section ON hris.staff_sections USING btree (section_id);

CREATE INDEX idx_staff_sections_staff ON hris.staff_sections USING btree (staff_id);
