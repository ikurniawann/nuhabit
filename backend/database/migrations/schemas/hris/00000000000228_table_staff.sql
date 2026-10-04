-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.staff
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:07.638Z
-- =============================================================================

-- Table: hris.staff
CREATE TABLE "hris"."staff" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "full_name" text NOT NULL,
    "employee_code" text NOT NULL,
    "email" text,
    "phone" text,
    "position_id" uuid,
    "brand_id" uuid NOT NULL,
    "hire_date" date NOT NULL,
    "status" text DEFAULT 'active'::text NOT NULL,
    "photo_url" text,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."staff"
    ADD CONSTRAINT "staff_employee_code_key" UNIQUE (employee_code);

ALTER TABLE ONLY "hris"."staff"
    ADD CONSTRAINT "staff_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "hris"."staff"
    ADD CONSTRAINT "staff_status_check" CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'resigned'::text]));

CREATE INDEX idx_staff_brand ON hris.staff USING btree (brand_id);

CREATE INDEX idx_staff_status ON hris.staff USING btree (status);
