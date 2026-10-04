-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: public.notifications
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:29.771Z
-- =============================================================================

-- Table: public.notifications
CREATE TABLE "public"."notifications" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "title" text NOT NULL,
    "message" text NOT NULL,
    "type" text NOT NULL,
    "link" text,
    "metadata" jsonb DEFAULT '{}'::jsonb,
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT now(),
    "read_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_type_check" CHECK (type = ANY (ARRAY['approval'::text, 'status_change'::text, 'reminder'::text, 'alert'::text]));

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, is_read, created_at DESC) WHERE (is_read = false);
