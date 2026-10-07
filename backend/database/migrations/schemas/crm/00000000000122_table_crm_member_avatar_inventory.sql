-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: crm.crm_member_avatar_inventory
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:57.240Z
-- =============================================================================

-- Table: crm.crm_member_avatar_inventory
CREATE TABLE "crm"."crm_member_avatar_inventory" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "member_id" uuid NOT NULL,
    "avatar_id" uuid NOT NULL,
    "redemption_id" uuid,
    "acquisition_source" text DEFAULT 'redemption'::text NOT NULL,
    "acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
    "is_equipped" boolean DEFAULT false NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "crm"."crm_member_avatar_inventory"
    ADD CONSTRAINT "crm_member_avatar_inventory_unique" UNIQUE (member_id, avatar_id);

ALTER TABLE ONLY "crm"."crm_member_avatar_inventory"
    ADD CONSTRAINT "crm_member_avatar_inventory_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "crm"."crm_member_avatar_inventory"
    ADD CONSTRAINT "crm_member_avatar_inventory_source_check" CHECK (acquisition_source = ANY (ARRAY['redemption'::text, 'campaign'::text, 'manual'::text, 'migration'::text, 'partner'::text]));

CREATE INDEX crm_member_avatar_inventory_avatar_idx ON crm.crm_member_avatar_inventory USING btree (avatar_id);

CREATE INDEX crm_member_avatar_inventory_member_idx ON crm.crm_member_avatar_inventory USING btree (member_id);
