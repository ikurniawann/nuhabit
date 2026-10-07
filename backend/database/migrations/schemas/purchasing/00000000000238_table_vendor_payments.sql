-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: purchasing.vendor_payments
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:13.615Z
-- =============================================================================

-- Table: purchasing.vendor_payments
CREATE TABLE "purchasing"."vendor_payments" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "payment_number" text NOT NULL,
    "purchase_order_id" uuid NOT NULL,
    "payment_term_id" uuid,
    "supplier_id" uuid NOT NULL,
    "payment_date" date DEFAULT CURRENT_DATE NOT NULL,
    "amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "method" text DEFAULT 'bank_transfer'::text NOT NULL,
    "reference_number" text,
    "notes" text,
    "status" text DEFAULT 'posted'::text NOT NULL,
    "created_by" uuid,
    "updated_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "purchasing"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_payment_number_key" UNIQUE (payment_number);

ALTER TABLE ONLY "purchasing"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "purchasing"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_amount_check" CHECK (amount >= 0::numeric);

ALTER TABLE ONLY "purchasing"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_method_check" CHECK (method = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'giro'::text, 'qris'::text, 'other'::text]));

ALTER TABLE ONLY "purchasing"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'posted'::text, 'void'::text]));

CREATE INDEX idx_vendor_payments_po ON purchasing.vendor_payments USING btree (purchase_order_id);

CREATE INDEX idx_vendor_payments_supplier ON purchasing.vendor_payments USING btree (supplier_id);
