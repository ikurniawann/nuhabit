-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: crm.crm_rewards
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:00.150Z
-- =============================================================================

-- Table: crm.crm_rewards
CREATE TABLE "crm"."crm_rewards" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "code" text NOT NULL,
    "name" text NOT NULL,
    "reward_type" text NOT NULL,
    "xp_cost" integer NOT NULL,
    "required_tier_id" uuid,
    "linked_avatar_id" uuid,
    "stock_total" integer,
    "stock_redeemed" integer DEFAULT 0 NOT NULL,
    "max_redemptions_per_member" integer,
    "image_url" text,
    "reward_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "crm"."crm_rewards"
    ADD CONSTRAINT "crm_rewards_code_key" UNIQUE (code);

ALTER TABLE ONLY "crm"."crm_rewards"
    ADD CONSTRAINT "crm_rewards_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "crm"."crm_rewards"
    ADD CONSTRAINT "crm_rewards_date_range" CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at);

ALTER TABLE ONLY "crm"."crm_rewards"
    ADD CONSTRAINT "crm_rewards_max_per_member_positive" CHECK (max_redemptions_per_member IS NULL OR max_redemptions_per_member > 0);

ALTER TABLE ONLY "crm"."crm_rewards"
    ADD CONSTRAINT "crm_rewards_stock_redeemed_lte_total" CHECK (stock_total IS NULL OR stock_redeemed <= stock_total);

ALTER TABLE ONLY "crm"."crm_rewards"
    ADD CONSTRAINT "crm_rewards_stock_redeemed_positive" CHECK (stock_redeemed >= 0);

ALTER TABLE ONLY "crm"."crm_rewards"
    ADD CONSTRAINT "crm_rewards_stock_total_positive" CHECK (stock_total IS NULL OR stock_total >= 0);

ALTER TABLE ONLY "crm"."crm_rewards"
    ADD CONSTRAINT "crm_rewards_type_check" CHECK (reward_type = ANY (ARRAY['discount'::text, 'merchandise'::text, 'avatar'::text, 'voucher'::text, 'ark_coin'::text, 'custom'::text]));

ALTER TABLE ONLY "crm"."crm_rewards"
    ADD CONSTRAINT "crm_rewards_xp_cost_positive" CHECK (xp_cost >= 0);

CREATE INDEX crm_rewards_active_type_idx ON crm.crm_rewards USING btree (is_active, reward_type);

CREATE INDEX crm_rewards_required_tier_idx ON crm.crm_rewards USING btree (required_tier_id);
