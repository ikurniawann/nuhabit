-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: crm.crm_member_profiles
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:58.142Z
-- =============================================================================

-- Table: crm.crm_member_profiles
CREATE TABLE "crm"."crm_member_profiles" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "customer_id" uuid NOT NULL,
    "member_code" text DEFAULT ('ARK-'::text || upper(substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 10))) NOT NULL,
    "tier_id" uuid NOT NULL,
    "current_xp" integer DEFAULT 0 NOT NULL,
    "lifetime_xp" integer DEFAULT 0 NOT NULL,
    "spent_xp" integer DEFAULT 0 NOT NULL,
    "loyalty_score" numeric(14,2) DEFAULT 0 NOT NULL,
    "active_avatar_id" uuid,
    "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
    "last_activity_at" timestamp with time zone,
    "status" text DEFAULT 'active'::text NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "crm"."crm_member_profiles"
    ADD CONSTRAINT "crm_member_profiles_customer_unique" UNIQUE (customer_id);

ALTER TABLE ONLY "crm"."crm_member_profiles"
    ADD CONSTRAINT "crm_member_profiles_member_code_key" UNIQUE (member_code);

ALTER TABLE ONLY "crm"."crm_member_profiles"
    ADD CONSTRAINT "crm_member_profiles_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "crm"."crm_member_profiles"
    ADD CONSTRAINT "crm_member_profiles_current_xp_positive" CHECK (current_xp >= 0);

ALTER TABLE ONLY "crm"."crm_member_profiles"
    ADD CONSTRAINT "crm_member_profiles_lifetime_xp_positive" CHECK (lifetime_xp >= 0);

ALTER TABLE ONLY "crm"."crm_member_profiles"
    ADD CONSTRAINT "crm_member_profiles_loyalty_score_positive" CHECK (loyalty_score >= 0::numeric);

ALTER TABLE ONLY "crm"."crm_member_profiles"
    ADD CONSTRAINT "crm_member_profiles_spent_xp_positive" CHECK (spent_xp >= 0);

ALTER TABLE ONLY "crm"."crm_member_profiles"
    ADD CONSTRAINT "crm_member_profiles_status_check" CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'suspended'::text, 'merged'::text]));

CREATE INDEX crm_member_profiles_customer_idx ON crm.crm_member_profiles USING btree (customer_id);

CREATE INDEX crm_member_profiles_lifetime_xp_idx ON crm.crm_member_profiles USING btree (lifetime_xp DESC);

CREATE INDEX crm_member_profiles_tier_status_idx ON crm.crm_member_profiles USING btree (tier_id, status);

COMMENT ON TABLE "crm"."crm_member_profiles" IS 'CRM membership profile layer linked to POS customers.';
