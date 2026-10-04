-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: performance.feedback_categories
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:10.912Z
-- =============================================================================

-- Table: performance.feedback_categories
CREATE TABLE "performance"."feedback_categories" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" character varying(100) NOT NULL,
    "description" text,
    "weight" numeric(5,2) DEFAULT 20.00,
    "display_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "performance"."feedback_categories"
    ADD CONSTRAINT "feedback_categories_pkey" PRIMARY KEY (id);

CREATE INDEX idx_feedback_categories_active ON performance.feedback_categories USING btree (is_active);

COMMENT ON TABLE "performance"."feedback_categories" IS '5 behavioral metrics untuk 360° feedback';
