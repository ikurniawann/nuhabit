-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.employees
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:08.304Z
-- =============================================================================

-- Table: hris.employees
CREATE TABLE "hris"."employees" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "user_id" uuid,
    "old_staff_id" uuid,
    "full_name" text NOT NULL,
    "nip" text NOT NULL,
    "ktp" text,
    "npwp" text,
    "email" text NOT NULL,
    "phone" text NOT NULL,
    "birth_date" date,
    "gender" gender_type,
    "marital_status" marital_status_type,
    "address" text,
    "city" text,
    "province" text,
    "postal_code" text,
    "join_date" date NOT NULL,
    "end_date" date,
    "employment_status" character varying(50) DEFAULT 'probation'::character varying NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "department_id" uuid,
    "section_id" uuid,
    "job_title_id" uuid,
    "reporting_to" uuid,
    "bank_name" text,
    "bank_account" text,
    "bpjs_tk" text,
    "bpjs_kesehatan" text,
    "emergency_contact_name" text,
    "emergency_contact_phone" text,
    "emergency_contact_relationship" text,
    "photo_url" text,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "hris"."employees"
    ADD CONSTRAINT "employees_ktp_key" UNIQUE (ktp);

ALTER TABLE ONLY "hris"."employees"
    ADD CONSTRAINT "employees_nip_key" UNIQUE (nip);

ALTER TABLE ONLY "hris"."employees"
    ADD CONSTRAINT "employees_npwp_key" UNIQUE (npwp);

ALTER TABLE ONLY "hris"."employees"
    ADD CONSTRAINT "employees_pkey" PRIMARY KEY (id);

CREATE INDEX idx_employees_active ON hris.employees USING btree (is_active);

CREATE INDEX idx_employees_department ON hris.employees USING btree (department_id);

CREATE INDEX idx_employees_email ON hris.employees USING btree (email);

CREATE INDEX idx_employees_job_title ON hris.employees USING btree (job_title_id);

CREATE INDEX idx_employees_join_date ON hris.employees USING btree (join_date);

CREATE INDEX idx_employees_ktp ON hris.employees USING btree (ktp);

CREATE INDEX idx_employees_nip ON hris.employees USING btree (nip);

CREATE INDEX idx_employees_npwp ON hris.employees USING btree (npwp);

CREATE INDEX idx_employees_old_staff ON hris.employees USING btree (old_staff_id);

CREATE INDEX idx_employees_reporting_to ON hris.employees USING btree (reporting_to);

CREATE INDEX idx_employees_section ON hris.employees USING btree (section_id);

CREATE INDEX idx_employees_status ON hris.employees USING btree (employment_status);

CREATE INDEX idx_employees_user ON hris.employees USING btree (user_id);

COMMENT ON TABLE "hris"."employees" IS 'Master data karyawan - menggantikan tabel staff';
COMMENT ON COLUMN "hris"."employees"."old_staff_id" IS 'Reference ke tabel staff lama untuk migrasi data';
COMMENT ON COLUMN "hris"."employees"."nip" IS 'Nomor Induk Karyawan - auto-generated format EMP-YYYY-XXXXX';
