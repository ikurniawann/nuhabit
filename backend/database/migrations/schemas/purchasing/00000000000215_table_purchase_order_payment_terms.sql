-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.purchase_order_payment_terms
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:59.602Z
-- =============================================================================

-- Table: purchasing.purchase_order_payment_terms
CREATE TABLE "purchasing"."purchase_order_payment_terms" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "purchase_order_id" uuid NOT NULL,
    "supplier_id" uuid NOT NULL,
    "term_no" integer DEFAULT 1 NOT NULL,
    "description" text,
    "due_date" date NOT NULL,
    "amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "paid_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "status" text DEFAULT 'unpaid'::text NOT NULL,
    "notes" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" uuid,
    "updated_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "purchasing"."purchase_order_payment_terms"
    ADD CONSTRAINT "purchase_order_payment_terms_purchase_order_id_term_no_key" UNIQUE (purchase_order_id, term_no);

ALTER TABLE ONLY "purchasing"."purchase_order_payment_terms"
    ADD CONSTRAINT "purchase_order_payment_terms_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "purchasing"."purchase_order_payment_terms"
    ADD CONSTRAINT "purchase_order_payment_terms_amount_check" CHECK (amount >= 0::numeric);

ALTER TABLE ONLY "purchasing"."purchase_order_payment_terms"
    ADD CONSTRAINT "purchase_order_payment_terms_paid_amount_check" CHECK (paid_amount >= 0::numeric);

ALTER TABLE ONLY "purchasing"."purchase_order_payment_terms"
    ADD CONSTRAINT "purchase_order_payment_terms_status_check" CHECK (status = ANY (ARRAY['unpaid'::text, 'partial'::text, 'paid'::text, 'overdue'::text, 'cancelled'::text]));

CREATE INDEX idx_po_payment_terms_due ON purchasing.purchase_order_payment_terms USING btree (status, due_date) WHERE (is_active = true);

CREATE INDEX idx_po_payment_terms_po ON purchasing.purchase_order_payment_terms USING btree (purchase_order_id);
