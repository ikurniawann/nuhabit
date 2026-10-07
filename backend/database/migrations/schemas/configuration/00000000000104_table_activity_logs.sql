-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: configuration.activity_logs
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:42.248Z
-- =============================================================================

-- Table: configuration.activity_logs
CREATE TABLE "configuration"."activity_logs" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "candidate_id" uuid NOT NULL,
    "action" text NOT NULL,
    "details" jsonb,
    "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "configuration"."activity_logs"
    ADD CONSTRAINT "activity_logs_pkey" PRIMARY KEY (id);
