-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: public.ai_assistant_messages
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:43.536Z
-- =============================================================================

-- Table: public.ai_assistant_messages
CREATE TABLE "public"."ai_assistant_messages" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "session_id" uuid NOT NULL,
    "role" text NOT NULL,
    "content" text NOT NULL,
    "meta" jsonb,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "public"."ai_assistant_messages"
    ADD CONSTRAINT "ai_assistant_messages_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."ai_assistant_messages"
    ADD CONSTRAINT "ai_assistant_messages_role_check" CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text]));

CREATE INDEX idx_ai_assistant_messages_session ON public.ai_assistant_messages USING btree (session_id, created_at);
