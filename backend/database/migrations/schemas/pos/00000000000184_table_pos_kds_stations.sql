-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_kds_stations
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:40.843Z
-- =============================================================================

-- Table: pos.pos_kds_stations
CREATE TABLE "pos"."pos_kds_stations" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "name" character varying(100) NOT NULL,
    "display_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "pos"."pos_kds_stations"
    ADD CONSTRAINT "pos_kds_stations_pkey" PRIMARY KEY (id);
