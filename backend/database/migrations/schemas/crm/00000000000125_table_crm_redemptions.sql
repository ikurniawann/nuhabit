-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: crm.crm_redemptions
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:59.466Z
-- =============================================================================

-- Table: crm.crm_redemptions
CREATE TABLE "crm"."crm_redemptions" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "redemption_number" text DEFAULT ((('RDM-'::text || to_char(now(), 'YYYYMMDD'::text)) || '-'::text) || upper(substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 8))) NOT NULL,
    "member_id" uuid NOT NULL,
    "customer_id" uuid,
    "reward_id" uuid NOT NULL,
    "xp_cost" integer NOT NULL,
    "xp_ledger_id" uuid,
    "status" text DEFAULT 'pending'::text NOT NULL,
    "voucher_code" text,
    "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
    "approved_at" timestamp with time zone,
    "fulfilled_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "notes" text,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "crm"."crm_redemptions"
    ADD CONSTRAINT "crm_redemptions_redemption_number_key" UNIQUE (redemption_number);

ALTER TABLE ONLY "crm"."crm_redemptions"
    ADD CONSTRAINT "crm_redemptions_voucher_code_key" UNIQUE (voucher_code);

ALTER TABLE ONLY "crm"."crm_redemptions"
    ADD CONSTRAINT "crm_redemptions_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "crm"."crm_redemptions"
    ADD CONSTRAINT "crm_redemptions_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'fulfilled'::text, 'cancelled'::text, 'expired'::text]));

ALTER TABLE ONLY "crm"."crm_redemptions"
    ADD CONSTRAINT "crm_redemptions_xp_cost_positive" CHECK (xp_cost >= 0);

CREATE INDEX crm_redemptions_member_status_idx ON crm.crm_redemptions USING btree (member_id, status, requested_at DESC);

CREATE INDEX crm_redemptions_reward_idx ON crm.crm_redemptions USING btree (reward_id);
