-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: configuration.user_approval_permissions
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:11.774Z
-- =============================================================================

-- Table: configuration.user_approval_permissions
CREATE TABLE "configuration"."user_approval_permissions" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "user_id" uuid NOT NULL,
    "module" text NOT NULL,
    "workflow" text NOT NULL,
    "approval_level" text NOT NULL,
    "approval_limit" numeric(14,2),
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" uuid,
    "updated_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "configuration"."user_approval_permissions"
    ADD CONSTRAINT "user_approval_permissions_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "configuration"."user_approval_permissions"
    ADD CONSTRAINT "user_approval_permissions_level_check" CHECK (approval_level = ANY (ARRAY['checker'::text, 'approver'::text, 'final_approver'::text]));

ALTER TABLE ONLY "configuration"."user_approval_permissions"
    ADD CONSTRAINT "user_approval_permissions_limit_check" CHECK (approval_limit IS NULL OR approval_limit >= 0::numeric);

CREATE UNIQUE INDEX user_approval_permissions_unique_active ON configuration.user_approval_permissions USING btree (user_id, module, workflow, approval_level) WHERE (is_active = true);

CREATE INDEX user_approval_permissions_user_idx ON configuration.user_approval_permissions USING btree (user_id);

CREATE INDEX user_approval_permissions_workflow_idx ON configuration.user_approval_permissions USING btree (module, workflow, is_active);
