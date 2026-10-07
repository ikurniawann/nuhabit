-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: public.ai_assistant_sessions
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:44.437Z
-- =============================================================================

-- Table: public.ai_assistant_sessions
CREATE TABLE "public"."ai_assistant_sessions" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "title" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "public"."ai_assistant_sessions"
    ADD CONSTRAINT "ai_assistant_sessions_pkey" PRIMARY KEY (id);

CREATE INDEX idx_ai_assistant_sessions_user ON public.ai_assistant_sessions USING btree (user_id, updated_at DESC);
