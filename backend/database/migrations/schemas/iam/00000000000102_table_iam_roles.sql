-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: iam.roles
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:40.682Z
-- =============================================================================

-- Table: iam.roles
CREATE TABLE "iam"."roles" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "code" character varying(50) NOT NULL,
    "name" character varying(100) NOT NULL,
    "description" text,
    "is_system" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "version" integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY "iam"."roles"
    ADD CONSTRAINT "roles_code_unique" UNIQUE (code);

ALTER TABLE ONLY "iam"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY (id);

CREATE INDEX roles_active_idx ON iam.roles USING btree (code) WHERE ((deleted_at IS NULL) AND (is_active = true));

COMMENT ON TABLE "iam"."roles" IS 'Master IAM roles';
