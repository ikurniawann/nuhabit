-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: crm.crm_membership_tiers
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:58.795Z
-- =============================================================================

-- Table: crm.crm_membership_tiers
CREATE TABLE "crm"."crm_membership_tiers" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "code" text NOT NULL,
    "name" text NOT NULL,
    "rank" integer NOT NULL,
    "min_lifetime_xp" integer DEFAULT 0 NOT NULL,
    "min_total_spend" numeric(14,2) DEFAULT 0 NOT NULL,
    "xp_multiplier" numeric(6,2) DEFAULT 1 NOT NULL,
    "discount_percent" numeric(6,2) DEFAULT 0 NOT NULL,
    "benefits" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "display_color" text DEFAULT '#6B7280'::text NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "crm"."crm_membership_tiers"
    ADD CONSTRAINT "crm_membership_tiers_code_key" UNIQUE (code);

ALTER TABLE ONLY "crm"."crm_membership_tiers"
    ADD CONSTRAINT "crm_membership_tiers_rank_key" UNIQUE (rank);

ALTER TABLE ONLY "crm"."crm_membership_tiers"
    ADD CONSTRAINT "crm_membership_tiers_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "crm"."crm_membership_tiers"
    ADD CONSTRAINT "crm_membership_tiers_discount_range" CHECK (discount_percent >= 0::numeric AND discount_percent <= 100::numeric);

ALTER TABLE ONLY "crm"."crm_membership_tiers"
    ADD CONSTRAINT "crm_membership_tiers_min_lifetime_xp_positive" CHECK (min_lifetime_xp >= 0);

ALTER TABLE ONLY "crm"."crm_membership_tiers"
    ADD CONSTRAINT "crm_membership_tiers_min_total_spend_positive" CHECK (min_total_spend >= 0::numeric);

ALTER TABLE ONLY "crm"."crm_membership_tiers"
    ADD CONSTRAINT "crm_membership_tiers_rank_positive" CHECK (rank > 0);

ALTER TABLE ONLY "crm"."crm_membership_tiers"
    ADD CONSTRAINT "crm_membership_tiers_xp_multiplier_positive" CHECK (xp_multiplier >= 0::numeric);

CREATE INDEX crm_membership_tiers_active_rank_idx ON crm.crm_membership_tiers USING btree (is_active, rank);
