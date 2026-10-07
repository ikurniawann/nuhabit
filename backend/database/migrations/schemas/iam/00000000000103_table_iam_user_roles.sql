-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: iam.user_roles
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:41.319Z
-- =============================================================================

-- Table: iam.user_roles
CREATE TABLE "iam"."user_roles" (
    "user_id" uuid NOT NULL,
    "role_id" uuid NOT NULL,
    "is_primary" boolean DEFAULT true NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
    "assigned_by" uuid
);

ALTER TABLE ONLY "iam"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY (user_id, role_id);

CREATE UNIQUE INDEX user_roles_one_primary_idx ON iam.user_roles USING btree (user_id) WHERE (is_primary = true);

CREATE INDEX user_roles_role_idx ON iam.user_roles USING btree (role_id);

COMMENT ON TABLE "iam"."user_roles" IS 'User to role assignments (primary role for phase 1)';
