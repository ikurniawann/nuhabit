-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.vendor_documents
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:13.004Z
-- =============================================================================

-- Table: purchasing.vendor_documents
CREATE TABLE "purchasing"."vendor_documents" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "intake_number" text,
    "document_type" text NOT NULL,
    "supplier_id" uuid,
    "supplier_name_text" text,
    "document_number" text,
    "document_date" date,
    "total_amount" numeric(18,2),
    "currency" text DEFAULT 'IDR'::text NOT NULL,
    "storage_provider" text DEFAULT 'external_cdn'::text NOT NULL,
    "file_url" text NOT NULL,
    "file_path" text,
    "file_mime" text,
    "file_size" bigint,
    "status" text DEFAULT 'pending_review'::text NOT NULL,
    "ocr_status" text DEFAULT 'none'::text NOT NULL,
    "uploaded_by" uuid,
    "reviewed_by" uuid,
    "reviewed_at" timestamp with time zone,
    "purchase_order_id" uuid,
    "notes" text,
    "review_notes" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "purchasing"."vendor_documents"
    ADD CONSTRAINT "vendor_documents_intake_number_key" UNIQUE (intake_number);

ALTER TABLE ONLY "purchasing"."vendor_documents"
    ADD CONSTRAINT "vendor_documents_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "purchasing"."vendor_documents"
    ADD CONSTRAINT "vendor_documents_document_type_check" CHECK (document_type = ANY (ARRAY['sales_order'::text, 'vendor_invoice'::text, 'quotation'::text, 'faktur'::text, 'nota'::text, 'other'::text]));

ALTER TABLE ONLY "purchasing"."vendor_documents"
    ADD CONSTRAINT "vendor_documents_ocr_status_check" CHECK (ocr_status = ANY (ARRAY['none'::text, 'queued'::text, 'processing'::text, 'done'::text, 'failed'::text]));

ALTER TABLE ONLY "purchasing"."vendor_documents"
    ADD CONSTRAINT "vendor_documents_status_check" CHECK (status = ANY (ARRAY['uploaded'::text, 'pending_review'::text, 'ready_to_create_po'::text, 'converted_to_po'::text, 'rejected'::text, 'archived'::text]));

CREATE INDEX idx_vendor_documents_purchase_order ON purchasing.vendor_documents USING btree (purchase_order_id) WHERE (purchase_order_id IS NOT NULL);

CREATE INDEX idx_vendor_documents_status ON purchasing.vendor_documents USING btree (status) WHERE (is_active = true);

CREATE INDEX idx_vendor_documents_supplier ON purchasing.vendor_documents USING btree (supplier_id) WHERE (is_active = true);

CREATE INDEX idx_vendor_documents_uploaded_by ON purchasing.vendor_documents USING btree (uploaded_by, created_at DESC) WHERE (is_active = true);
