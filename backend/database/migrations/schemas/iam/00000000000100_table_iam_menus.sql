-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: iam.menus
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:39.420Z
-- =============================================================================

-- Table: iam.menus
CREATE TABLE "iam"."menus" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "parent_id" uuid,
    "code" character varying(100) NOT NULL,
    "menu_name" character varying(100) NOT NULL,
    "description" text,
    "permission_context" jsonb DEFAULT '{"actions": ["read"]}'::jsonb NOT NULL,
    "route_path" character varying(255),
    "module" character varying(50),
    "menu_type" character varying(20) DEFAULT 'sidebar'::character varying NOT NULL,
    "icon" character varying(100),
    "level" integer DEFAULT 1 NOT NULL,
    "order_number" integer DEFAULT 0 NOT NULL,
    "is_visible" boolean DEFAULT true NOT NULL,
    "open_in_new_tab" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_by" uuid,
    "updated_at" timestamp with time zone,
    "updated_by" uuid,
    "deleted_at" timestamp with time zone,
    "deleted_by" uuid,
    "version" integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY "iam"."menus"
    ADD CONSTRAINT "menus_code_unique" UNIQUE (code);

ALTER TABLE ONLY "iam"."menus"
    ADD CONSTRAINT "menus_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "iam"."menus"
    ADD CONSTRAINT "menus_level_check" CHECK (level >= 1);

ALTER TABLE ONLY "iam"."menus"
    ADD CONSTRAINT "menus_menu_type_check" CHECK (menu_type::text = ANY (ARRAY['sidebar'::character varying, 'group'::character varying]::text[]));

CREATE INDEX menus_active_tree_idx ON iam.menus USING btree (parent_id, order_number) WHERE ((deleted_at IS NULL) AND (is_active = true) AND (is_visible = true));

CREATE INDEX menus_parent_idx ON iam.menus USING btree (parent_id) WHERE (deleted_at IS NULL);

CREATE INDEX menus_route_idx ON iam.menus USING btree (route_path) WHERE ((deleted_at IS NULL) AND (route_path IS NOT NULL));

COMMENT ON TABLE "iam"."menus" IS 'Master navigation menu tree with permission template';
COMMENT ON COLUMN "iam"."menus"."permission_context" IS 'Available actions template for this menu';
COMMENT ON COLUMN "iam"."menus"."menu_type" IS 'sidebar = navigable page, group = expandable module folder';
