-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: crm.crm_xp_rules
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:01.364Z
-- =============================================================================

-- Table: crm.crm_xp_rules
CREATE TABLE "crm"."crm_xp_rules" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "code" text NOT NULL,
    "name" text NOT NULL,
    "source_channel" text NOT NULL,
    "source_type" text NOT NULL,
    "source_id" text,
    "outlet_scope" text DEFAULT 'all'::text NOT NULL,
    "outlet_id" uuid,
    "xp_mode" text NOT NULL,
    "xp_value" numeric(14,4) NOT NULL,
    "amount_step" numeric(14,2) DEFAULT 1 NOT NULL,
    "min_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "max_xp_per_event" integer,
    "tier_multiplier_enabled" boolean DEFAULT true NOT NULL,
    "priority" integer DEFAULT 100 NOT NULL,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "crm"."crm_xp_rules"
    ADD CONSTRAINT "crm_xp_rules_code_key" UNIQUE (code);

ALTER TABLE ONLY "crm"."crm_xp_rules"
    ADD CONSTRAINT "crm_xp_rules_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "crm"."crm_xp_rules"
    ADD CONSTRAINT "crm_xp_rules_amount_step_positive" CHECK (amount_step > 0::numeric);

ALTER TABLE ONLY "crm"."crm_xp_rules"
    ADD CONSTRAINT "crm_xp_rules_date_range" CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at);

ALTER TABLE ONLY "crm"."crm_xp_rules"
    ADD CONSTRAINT "crm_xp_rules_max_xp_positive" CHECK (max_xp_per_event IS NULL OR max_xp_per_event >= 0);

ALTER TABLE ONLY "crm"."crm_xp_rules"
    ADD CONSTRAINT "crm_xp_rules_min_amount_positive" CHECK (min_amount >= 0::numeric);

ALTER TABLE ONLY "crm"."crm_xp_rules"
    ADD CONSTRAINT "crm_xp_rules_outlet_required" CHECK (outlet_scope = 'all'::text AND outlet_id IS NULL OR outlet_scope = 'specific'::text AND outlet_id IS NOT NULL);

ALTER TABLE ONLY "crm"."crm_xp_rules"
    ADD CONSTRAINT "crm_xp_rules_outlet_scope_check" CHECK (outlet_scope = ANY (ARRAY['all'::text, 'specific'::text]));

ALTER TABLE ONLY "crm"."crm_xp_rules"
    ADD CONSTRAINT "crm_xp_rules_source_channel_check" CHECK (source_channel = ANY (ARRAY['pos'::text, 'photobooth'::text, 'studio_game'::text, 'manual'::text, 'campaign'::text]));

ALTER TABLE ONLY "crm"."crm_xp_rules"
    ADD CONSTRAINT "crm_xp_rules_xp_mode_check" CHECK (xp_mode = ANY (ARRAY['fixed'::text, 'per_item'::text, 'per_amount'::text, 'multiplier'::text, 'percentage'::text]));

ALTER TABLE ONLY "crm"."crm_xp_rules"
    ADD CONSTRAINT "crm_xp_rules_xp_value_positive" CHECK (xp_value >= 0::numeric);

CREATE INDEX crm_xp_rules_active_window_idx ON crm.crm_xp_rules USING btree (is_active, starts_at, ends_at);

CREATE INDEX crm_xp_rules_match_idx ON crm.crm_xp_rules USING btree (source_channel, source_type, source_id, outlet_scope, outlet_id, is_active, priority);

COMMENT ON TABLE "crm"."crm_xp_rules" IS 'Configurable XP earning rules for POS, photobooth, studio games, manual, and campaign events.';
COMMENT ON COLUMN "crm"."crm_xp_rules"."source_id" IS 'Flexible text source ID: POS product UUID, partner package ID, game ID, stage ID, or NULL for global rule.';
COMMENT ON COLUMN "crm"."crm_xp_rules"."outlet_id" IS 'Outlet UUID when outlet_scope is specific. Kept nullable because outlet master schema is not yet finalized.';
