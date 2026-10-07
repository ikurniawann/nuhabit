-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: hris.employee_documents
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:05.562Z
-- =============================================================================

-- Table: hris.employee_documents
CREATE TABLE "hris"."employee_documents" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "employee_id" uuid NOT NULL,
    "document_type" character varying(50) NOT NULL,
    "document_name" character varying(255) NOT NULL,
    "file_url" text NOT NULL,
    "file_size_kb" integer,
    "mime_type" character varying(100),
    "issue_date" date,
    "expiry_date" date,
    "is_verified" boolean DEFAULT false,
    "verified_by" uuid,
    "verified_at" timestamp with time zone,
    "notes" text,
    "uploaded_by" uuid,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "hris"."employee_documents"
    ADD CONSTRAINT "employee_documents_pkey" PRIMARY KEY (id);

CREATE INDEX idx_employee_documents_employee ON hris.employee_documents USING btree (employee_id);

CREATE INDEX idx_employee_documents_type ON hris.employee_documents USING btree (document_type);
