-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: crm.crm_external_events
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:55.677Z
-- =============================================================================

-- Table: crm.crm_external_events
CREATE TABLE "crm"."crm_external_events" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "partner_id" uuid NOT NULL,
    "external_event_id" text NOT NULL,
    "source_channel" text NOT NULL,
    "event_type" text NOT NULL,
    "customer_id" uuid,
    "member_id" uuid,
    "customer_identifier" text,
    "outlet_id" uuid,
    "xp_rule_id" uuid,
    "xp_ledger_id" uuid,
    "processing_status" text DEFAULT 'pending'::text NOT NULL,
    "error_message" text,
    "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "received_at" timestamp with time zone DEFAULT now() NOT NULL,
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "crm"."crm_external_events"
    ADD CONSTRAINT "crm_external_events_partner_event_unique" UNIQUE (partner_id, external_event_id);

ALTER TABLE ONLY "crm"."crm_external_events"
    ADD CONSTRAINT "crm_external_events_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "crm"."crm_external_events"
    ADD CONSTRAINT "crm_external_events_source_channel_check" CHECK (source_channel = ANY (ARRAY['photobooth'::text, 'studio_game'::text]));

ALTER TABLE ONLY "crm"."crm_external_events"
    ADD CONSTRAINT "crm_external_events_status_check" CHECK (processing_status = ANY (ARRAY['pending'::text, 'processed'::text, 'failed'::text, 'ignored'::text]));

CREATE INDEX crm_external_events_customer_identifier_idx ON crm.crm_external_events USING btree (customer_identifier);

CREATE INDEX crm_external_events_member_idx ON crm.crm_external_events USING btree (member_id);

CREATE INDEX crm_external_events_partner_status_idx ON crm.crm_external_events USING btree (partner_id, processing_status, received_at DESC);

COMMENT ON TABLE "crm"."crm_external_events" IS 'Idempotent audit table for partner events such as photobooth purchases and Studio Games activity.';
