-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: item.brands
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:51.636Z
-- =============================================================================

-- Table: item.brands
CREATE TABLE "item"."brands" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "name" text NOT NULL,
    "industry" text DEFAULT 'F&B'::text NOT NULL,
    "logo_url" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "item"."brands"
    ADD CONSTRAINT "brands_pkey" PRIMARY KEY (id);
