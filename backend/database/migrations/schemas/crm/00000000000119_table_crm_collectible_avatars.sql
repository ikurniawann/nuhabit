-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: crm.crm_collectible_avatars
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:54.124Z
-- =============================================================================

-- Table: crm.crm_collectible_avatars
CREATE TABLE "crm"."crm_collectible_avatars" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "code" text NOT NULL,
    "name" text NOT NULL,
    "rarity" text DEFAULT 'common'::text NOT NULL,
    "image_url" text NOT NULL,
    "thumbnail_url" text,
    "required_tier_id" uuid,
    "xp_cost" integer DEFAULT 0 NOT NULL,
    "stock_total" integer,
    "stock_redeemed" integer DEFAULT 0 NOT NULL,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "crm"."crm_collectible_avatars"
    ADD CONSTRAINT "crm_collectible_avatars_code_key" UNIQUE (code);

ALTER TABLE ONLY "crm"."crm_collectible_avatars"
    ADD CONSTRAINT "crm_collectible_avatars_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "crm"."crm_collectible_avatars"
    ADD CONSTRAINT "crm_collectible_avatars_rarity_check" CHECK (rarity = ANY (ARRAY['common'::text, 'rare'::text, 'epic'::text, 'legendary'::text, 'limited'::text]));

ALTER TABLE ONLY "crm"."crm_collectible_avatars"
    ADD CONSTRAINT "crm_collectible_avatars_stock_redeemed_lte_total" CHECK (stock_total IS NULL OR stock_redeemed <= stock_total);

ALTER TABLE ONLY "crm"."crm_collectible_avatars"
    ADD CONSTRAINT "crm_collectible_avatars_stock_redeemed_positive" CHECK (stock_redeemed >= 0);

ALTER TABLE ONLY "crm"."crm_collectible_avatars"
    ADD CONSTRAINT "crm_collectible_avatars_stock_total_positive" CHECK (stock_total IS NULL OR stock_total >= 0);

ALTER TABLE ONLY "crm"."crm_collectible_avatars"
    ADD CONSTRAINT "crm_collectible_avatars_xp_cost_positive" CHECK (xp_cost >= 0);

CREATE INDEX crm_collectible_avatars_active_rarity_idx ON crm.crm_collectible_avatars USING btree (is_active, rarity);

CREATE INDEX crm_collectible_avatars_required_tier_idx ON crm.crm_collectible_avatars USING btree (required_tier_id);
