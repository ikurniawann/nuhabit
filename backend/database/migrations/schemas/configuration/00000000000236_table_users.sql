-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: configuration.users
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:12.354Z
-- =============================================================================

-- Table: configuration.users
CREATE TABLE "configuration"."users" (
    "id" uuid NOT NULL,
    "full_name" text NOT NULL,
    "role" text NOT NULL,
    "brand_id" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "pos_pin" text,
    "email" text,
    "status" text DEFAULT 'active'::text NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "configuration"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "configuration"."users"
    ADD CONSTRAINT "users_role_check" CHECK (role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'hrd'::text, 'hiring_manager'::text, 'direksi'::text, 'purchasing_admin'::text, 'purchasing_manager'::text, 'purchasing_staff'::text, 'finance_staff'::text, 'warehouse_staff'::text, 'warehouse_admin'::text, 'pos'::text, 'pos_supervisor'::text, 'qc_staff'::text]));

ALTER TABLE ONLY "configuration"."users"
    ADD CONSTRAINT "users_status_check" CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text]));

CREATE INDEX idx_users_pos_role_pin ON configuration.users USING btree (role, pos_pin) WHERE (role = 'pos_supervisor'::text);
