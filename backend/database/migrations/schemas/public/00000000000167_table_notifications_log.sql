-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: public.notifications_log
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:30.389Z
-- =============================================================================

-- Table: public.notifications_log
CREATE TABLE "public"."notifications_log" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "candidate_id" uuid,
    "channel" text NOT NULL,
    "message" text NOT NULL,
    "status" text DEFAULT 'pending'::text NOT NULL,
    "sent_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."notifications_log"
    ADD CONSTRAINT "notifications_log_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."notifications_log"
    ADD CONSTRAINT "notifications_log_channel_check" CHECK (channel = ANY (ARRAY['whatsapp'::text, 'email'::text]));

ALTER TABLE ONLY "public"."notifications_log"
    ADD CONSTRAINT "notifications_log_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text]));
