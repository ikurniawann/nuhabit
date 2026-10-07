-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.departments
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:02.625Z
-- =============================================================================

-- Table: hris.departments
CREATE TABLE "hris"."departments" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "name" text NOT NULL,
    "code" text NOT NULL,
    "description" text,
    "brand_id" uuid,
    "parent_department_id" uuid,
    "cost_center" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."departments"
    ADD CONSTRAINT "departments_code_key" UNIQUE (code);

ALTER TABLE ONLY "hris"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY (id);

CREATE INDEX idx_departments_active ON hris.departments USING btree (is_active);

CREATE INDEX idx_departments_brand ON hris.departments USING btree (brand_id);

CREATE INDEX idx_departments_code ON hris.departments USING btree (code);

CREATE INDEX idx_departments_parent ON hris.departments USING btree (parent_department_id);

COMMENT ON TABLE "hris"."departments" IS 'Struktur organisasi - department/divisi';
