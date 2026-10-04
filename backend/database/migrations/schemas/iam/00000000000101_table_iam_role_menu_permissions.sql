-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: iam.role_menu_permissions
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:40.074Z
-- =============================================================================

-- Table: iam.role_menu_permissions
CREATE TABLE "iam"."role_menu_permissions" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "role_id" uuid NOT NULL,
    "menu_id" uuid NOT NULL,
    "granted_actions" jsonb DEFAULT '["read"]'::jsonb NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_by" uuid,
    "updated_at" timestamp with time zone,
    "updated_by" uuid
);

ALTER TABLE ONLY "iam"."role_menu_permissions"
    ADD CONSTRAINT "role_menu_permissions_unique" UNIQUE (role_id, menu_id);

ALTER TABLE ONLY "iam"."role_menu_permissions"
    ADD CONSTRAINT "role_menu_permissions_pkey" PRIMARY KEY (id);

CREATE INDEX role_menu_permissions_menu_idx ON iam.role_menu_permissions USING btree (menu_id) WHERE (is_active = true);

CREATE INDEX role_menu_permissions_role_idx ON iam.role_menu_permissions USING btree (role_id) WHERE (is_active = true);

COMMENT ON TABLE "iam"."role_menu_permissions" IS 'Role to menu access mapping with granted actions';
COMMENT ON COLUMN "iam"."role_menu_permissions"."granted_actions" IS 'Actions granted to role for this menu';
