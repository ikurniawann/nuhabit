-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.purchase_requests
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:00.815Z
-- =============================================================================

-- Table: purchasing.purchase_requests
CREATE TABLE "purchasing"."purchase_requests" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "pr_number" text NOT NULL,
    "requester_id" uuid NOT NULL,
    "department_id" uuid NOT NULL,
    "status" text DEFAULT 'draft'::text,
    "total_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "priority" text DEFAULT 'medium'::text,
    "notes" text,
    "required_date" date,
    "current_approval_level" text,
    "approved_by_head" uuid,
    "approved_at_head" timestamp with time zone,
    "approved_by_finance" uuid,
    "approved_at_finance" timestamp with time zone,
    "approved_by_direksi" uuid,
    "approved_at_direksi" timestamp with time zone,
    "rejected_by" uuid,
    "rejected_at" timestamp with time zone,
    "rejection_reason" text,
    "converted_po_id" uuid,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY "purchasing"."purchase_requests"
    ADD CONSTRAINT "purchase_requests_pr_number_key" UNIQUE (pr_number);

ALTER TABLE ONLY "purchasing"."purchase_requests"
    ADD CONSTRAINT "purchase_requests_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "purchasing"."purchase_requests"
    ADD CONSTRAINT "purchase_requests_priority_check" CHECK (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text]));

ALTER TABLE ONLY "purchasing"."purchase_requests"
    ADD CONSTRAINT "purchase_requests_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'pending_head'::text, 'pending_finance'::text, 'pending_direksi'::text, 'approved'::text, 'rejected'::text, 'converted'::text]));

CREATE INDEX idx_pr_created ON purchasing.purchase_requests USING btree (created_at DESC);

CREATE INDEX idx_pr_department ON purchasing.purchase_requests USING btree (department_id);

CREATE INDEX idx_pr_requester ON purchasing.purchase_requests USING btree (requester_id);

CREATE INDEX idx_pr_status ON purchasing.purchase_requests USING btree (status);

CREATE INDEX idx_purchase_requests_converted_po_id ON purchasing.purchase_requests USING btree (converted_po_id);
