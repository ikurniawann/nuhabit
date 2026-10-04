-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: configuration.admin_user_audit_logs
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:42.847Z
-- =============================================================================

-- Table: configuration.admin_user_audit_logs
CREATE TABLE "configuration"."admin_user_audit_logs" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "actor_id" uuid,
    "target_user_id" uuid,
    "action" text NOT NULL,
    "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "configuration"."admin_user_audit_logs"
    ADD CONSTRAINT "admin_user_audit_logs_pkey" PRIMARY KEY (id);

CREATE INDEX admin_user_audit_logs_actor_idx ON configuration.admin_user_audit_logs USING btree (actor_id, created_at DESC);

CREATE INDEX admin_user_audit_logs_target_user_idx ON configuration.admin_user_audit_logs USING btree (target_user_id, created_at DESC);
