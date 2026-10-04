-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.positions
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:54.040Z
-- =============================================================================

-- Table: hris.positions
CREATE TABLE "hris"."positions" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "brand_id" uuid,
    "title" text NOT NULL,
    "department" text DEFAULT 'Operations'::text NOT NULL,
    "level" text DEFAULT 'Staff'::text NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."positions"
    ADD CONSTRAINT "positions_pkey" PRIMARY KEY (id);

CREATE INDEX idx_positions_brand ON hris.positions USING btree (brand_id);
