-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: crm.crm_xp_ledger
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:00.753Z
-- =============================================================================

-- Table: crm.crm_xp_ledger
CREATE TABLE "crm"."crm_xp_ledger" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "member_id" uuid NOT NULL,
    "customer_id" uuid,
    "direction" text NOT NULL,
    "source_channel" text NOT NULL,
    "source_type" text NOT NULL,
    "source_id" text,
    "outlet_id" uuid,
    "xp_delta" integer NOT NULL,
    "balance_before" integer NOT NULL,
    "balance_after" integer NOT NULL,
    "lifetime_before" integer DEFAULT 0 NOT NULL,
    "lifetime_after" integer DEFAULT 0 NOT NULL,
    "rule_id" uuid,
    "reference_table" text,
    "reference_id" text,
    "idempotency_key" text,
    "description" text,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "crm"."crm_xp_ledger"
    ADD CONSTRAINT "crm_xp_ledger_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "crm"."crm_xp_ledger"
    ADD CONSTRAINT "crm_xp_ledger_balance_positive" CHECK (balance_before >= 0 AND balance_after >= 0);

ALTER TABLE ONLY "crm"."crm_xp_ledger"
    ADD CONSTRAINT "crm_xp_ledger_direction_check" CHECK (direction = ANY (ARRAY['earn'::text, 'spend'::text, 'adjust'::text, 'reverse'::text, 'expire'::text]));

ALTER TABLE ONLY "crm"."crm_xp_ledger"
    ADD CONSTRAINT "crm_xp_ledger_lifetime_positive" CHECK (lifetime_before >= 0 AND lifetime_after >= 0);

ALTER TABLE ONLY "crm"."crm_xp_ledger"
    ADD CONSTRAINT "crm_xp_ledger_source_channel_check" CHECK (source_channel = ANY (ARRAY['pos'::text, 'photobooth'::text, 'studio_game'::text, 'manual'::text, 'campaign'::text, 'redemption'::text]));

ALTER TABLE ONLY "crm"."crm_xp_ledger"
    ADD CONSTRAINT "crm_xp_ledger_xp_delta_not_zero" CHECK (xp_delta <> 0);

CREATE INDEX crm_xp_ledger_customer_created_idx ON crm.crm_xp_ledger USING btree (customer_id, created_at DESC);

CREATE UNIQUE INDEX crm_xp_ledger_idempotency_key_idx ON crm.crm_xp_ledger USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);

CREATE INDEX crm_xp_ledger_member_created_idx ON crm.crm_xp_ledger USING btree (member_id, created_at DESC);

CREATE INDEX crm_xp_ledger_source_reference_idx ON crm.crm_xp_ledger USING btree (source_channel, source_type, reference_table, reference_id);

COMMENT ON TABLE "crm"."crm_xp_ledger" IS 'Immutable source of truth for member XP balance changes.';
COMMENT ON COLUMN "crm"."crm_xp_ledger"."idempotency_key" IS 'Unique event key used to prevent duplicate XP posting from POS or partner integrations.';
