-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: crm.crm_integration_partners
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:56.264Z
-- =============================================================================

-- Table: crm.crm_integration_partners
CREATE TABLE "crm"."crm_integration_partners" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "code" text NOT NULL,
    "name" text NOT NULL,
    "partner_type" text NOT NULL,
    "secret_hash" text,
    "webhook_url" text,
    "allowed_event_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "crm"."crm_integration_partners"
    ADD CONSTRAINT "crm_integration_partners_code_key" UNIQUE (code);

ALTER TABLE ONLY "crm"."crm_integration_partners"
    ADD CONSTRAINT "crm_integration_partners_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "crm"."crm_integration_partners"
    ADD CONSTRAINT "crm_integration_partners_type_check" CHECK (partner_type = ANY (ARRAY['photobooth'::text, 'studio_game'::text, 'other'::text]));

CREATE INDEX crm_integration_partners_active_type_idx ON crm.crm_integration_partners USING btree (is_active, partner_type);
